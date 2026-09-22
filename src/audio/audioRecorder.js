/**
 * @fileoverview Audio recording management
 * @description Manages starting, stopping, and handling recordings in coordination with AudioStreamer.
 * Does not spawn an independent SOX process; receives MP3 output from AudioStreamer and saves it to file.
 * Supports templates containing directory hierarchies.
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { generateFilename, getUniqueFilename, fromReceptionData } = require('./fileNamer');

/**
 * Audio recorder management class
 * Saves audio to files using the recording pipe from AudioStreamer's integrated SOX process.
 * @extends EventEmitter
 * @fires AudioRecorder#recordingStart - On recording start
 * @fires AudioRecorder#recordingStop - On recording stop
 * @fires AudioRecorder#recordingError - On recording error
 */
class AudioRecorder extends EventEmitter {
  /**
   * @param {Object} audioConfig - Audio recording configuration
   * @param {Object} fileNamingConfig - File naming configuration
   * @param {import('./audioStreamer')} audioStreamer - AudioStreamer instance
   * @param {boolean} [mockMode=false] - Mock mode flag
   */
  constructor(audioConfig, fileNamingConfig, audioStreamer, mockMode = false) {
    super();

    /** @type {Object} Audio configuration */
    this._audioConfig = audioConfig;

    /** @type {Object} File naming configuration */
    this._fileNamingConfig = fileNamingConfig;

    /** @type {import('./audioStreamer')} AudioStreamer instance */
    this._audioStreamer = audioStreamer;

    /** @type {boolean} Mock mode flag */
    this._mockMode = mockMode;

    /** @type {boolean} Recording in-progress flag */
    this._isRecording = false;

    /** @type {string|null} Current recording file path */
    this._currentFilePath = null;

    /** @type {Date|null} Recording start time */
    this._recordingStartTime = null;

    /** @type {Object|null} Current reception metadata */
    this._currentReception = null;

    // Create recordings directory if not exists
    this._ensureRecordingsDir();
  }

  /**
   * Ensure the recordings directory exists, create if missing
   * @private
   */
  _ensureRecordingsDir() {
    const dir = this._audioConfig.recordingsDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[AudioRecorder] Created recordings directory: ${dir}`);
    }
  }

  /**
   * Start recording
   * Writes to a file using AudioStreamer's recording pipe.
   * Intermediate directories are automatically created if the template contains directory hierarchies.
   * @param {Object} reception - Reception metadata
   * @param {Date} startTime - Reception start time
   */
  startRecording(reception, startTime) {
    if (this._isRecording) {
      console.log('[AudioRecorder] Recording already in progress. Stopping previous recording first.');
      this.stopRecording();
    }

    this._currentReception = reception;
    this._recordingStartTime = startTime || new Date();

    // Generate filename (relative path)
    const params = fromReceptionData(reception, this._recordingStartTime);
    params.ext = this._audioConfig.format || 'mp3';

    const relativePath = generateFilename(this._fileNamingConfig.template, params);
    const uniqueRelativePath = getUniqueFilename(this._audioConfig.recordingsDir, relativePath);

    // Build absolute path
    this._currentFilePath = path.join(this._audioConfig.recordingsDir, uniqueRelativePath);

    // Create intermediate directories automatically
    const fileDir = path.dirname(this._currentFilePath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
      console.log(`[AudioRecorder] Created subdirectory: ${fileDir}`);
    }

    if (this._mockMode) {
      this._startMockRecording();
      return;
    }

    this._startPipeRecording();
  }

  /**
   * Start recording using AudioStreamer's recording pipe
   * @private
   */
  _startPipeRecording() {
    console.log(`[AudioRecorder] Starting pipe recording: ${this._currentFilePath}`);

    try {
      // Start recording pipe in AudioStreamer
      this._audioStreamer.startRecordingPipe(this._currentFilePath);
      this._isRecording = true;

      this.emit('recordingStart', {
        filePath: this._currentFilePath,
        filename: this._getRelativePath(this._currentFilePath),
        reception: this._currentReception,
        startTime: this._recordingStartTime,
      });
    } catch (err) {
      console.error(`[AudioRecorder] Recording start failed:`, err.message);
      this.emit('recordingError', { error: err.message });
    }
  }

  /**
   * Start mock recording
   * @private
   */
  _startMockRecording() {
    console.log(`[AudioRecorder] Starting mock recording: ${this._currentFilePath}`);
    this._isRecording = true;

    // Create an empty file for mock
    fs.writeFileSync(this._currentFilePath, '');

    this.emit('recordingStart', {
      filePath: this._currentFilePath,
      filename: this._getRelativePath(this._currentFilePath),
      reception: this._currentReception,
      startTime: this._recordingStartTime,
    });
  }

  /**
   * Stop recording
   * @returns {Object|null} Recording result information
   */
  stopRecording() {
    if (!this._isRecording) {
      return null;
    }

    const endTime = new Date();
    const duration = this._recordingStartTime
      ? (endTime - this._recordingStartTime) / 1000
      : 0;

    // Stop recording pipe in AudioStreamer
    if (!this._mockMode) {
      this._audioStreamer.stopRecordingPipe();
    }

    this._isRecording = false;

    const result = {
      filePath: this._currentFilePath,
      filename: this._getRelativePath(this._currentFilePath),
      reception: this._currentReception,
      startTime: this._recordingStartTime,
      endTime,
      durationSec: Math.round(duration * 10) / 10,
    };

    console.log(`[AudioRecorder] Recording stopped: ${result.filename} (${result.durationSec}s)`);

    this.emit('recordingStop', result);

    // Delete recordings that are too short (less than 1 second)
    if (duration < 1.0 && this._currentFilePath && fs.existsSync(this._currentFilePath)) {
      try {
        fs.unlinkSync(this._currentFilePath);
        console.log(`[AudioRecorder] Removed short duration recording: ${result.filename}`);
      } catch {
        // Ignore error
      }
    }

    this._currentFilePath = null;
    this._currentReception = null;
    this._recordingStartTime = null;

    return result;
  }

  /**
   * Check whether recording is in progress
   * @returns {boolean}
   */
  isRecording() {
    return this._isRecording;
  }

  /**
   * Retrieve list of recordings (recursively searches subdirectories)
   * @param {Object} [filters={}] - Filter criteria
   * @param {string} [filters.dateFrom] - Start date/time (ISO format)
   * @param {string} [filters.dateTo] - End date/time (ISO format)
   * @param {string} [filters.search] - Filename search keyword (substring match)
   * @returns {Array<Object>} List of file metadata
   */
  getRecordings(filters = {}) {
    const dir = this._audioConfig.recordingsDir;

    if (!fs.existsSync(dir)) {
      return [];
    }

    // Collect files recursively
    const files = this._collectRecordingFiles(dir, dir);

    // Apply filters
    let filtered = files;

    // Date range filter
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      if (!isNaN(from.getTime())) {
        filtered = filtered.filter((f) => new Date(f.createdAt) >= from);
      }
    }

    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      if (!isNaN(to.getTime())) {
        filtered = filtered.filter((f) => new Date(f.createdAt) <= to);
      }
    }

    // Filename search filter (case-insensitive substring match)
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter((f) => f.filename.toLowerCase().includes(searchLower));
    }

    // Sort descending by creation date
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return filtered;
  }

  /**
   * Recursively collect recording files under the specified directory
   * @param {string} currentDir - Currently inspected directory
   * @param {string} baseDir - Base recordings directory (for calculating relative path)
   * @returns {Array<Object>} List of file metadata
   * @private
   */
  _collectRecordingFiles(currentDir, baseDir) {
    const results = [];
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac'];

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Recursively inspect subdirectory
        const subResults = this._collectRecordingFiles(fullPath, baseDir);
        results.push(...subResults);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (audioExtensions.includes(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            // Relative path from base directory (normalized to `/`)
            const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
            results.push({
              filename: relativePath,
              size: stat.size,
              sizeFormatted: formatFileSize(stat.size),
              createdAt: stat.birthtime.toISOString(),
              modifiedAt: stat.mtime.toISOString(),
            });
          } catch {
            // Skip files whose stats cannot be retrieved
          }
        }
      }
    }

    return results;
  }

  /**
   * Get full path of a recording file (supports subdirectories)
   * @param {string} relativePath - Relative path from base directory
   * @returns {string|null} Absolute file path (or null if not found)
   */
  getRecordingPath(relativePath) {
    // Path traversal mitigation: normalize and ensure path stays within recordingsDir
    const normalizedPath = path.normalize(relativePath).replace(/\\/g, '/');

    // Reject leading `../` or absolute paths
    if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
      console.warn(`[AudioRecorder] Path traversal attempt detected: ${relativePath}`);
      return null;
    }

    const filePath = path.join(this._audioConfig.recordingsDir, normalizedPath);

    // Final check that path resides within recordings directory
    const resolvedBase = path.resolve(this._audioConfig.recordingsDir);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedBase)) {
      console.warn(`[AudioRecorder] Path traversal attempt detected: ${relativePath}`);
      return null;
    }

    if (fs.existsSync(filePath)) {
      return filePath;
    }

    return null;
  }

  /**
   * Delete a recording file (supports subdirectories)
   * @param {string} relativePath - Relative path from base directory
   * @returns {boolean} True if deleted successfully
   */
  deleteRecording(relativePath) {
    const filePath = this.getRecordingPath(relativePath);
    if (filePath) {
      fs.unlinkSync(filePath);

      // Automatically remove empty parent directories
      this._removeEmptyParentDirs(path.dirname(filePath));

      return true;
    }
    return false;
  }

  /**
   * Recursively remove empty parent directories up to the base recordings directory
   * @param {string} dir - Directory to check
   * @private
   */
  _removeEmptyParentDirs(dir) {
    const baseDir = path.resolve(this._audioConfig.recordingsDir);
    const resolvedDir = path.resolve(dir);

    // Do not delete the base directory itself
    if (resolvedDir === baseDir || !resolvedDir.startsWith(baseDir)) {
      return;
    }

    try {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        console.log(`[AudioRecorder] Removed empty directory: ${dir}`);
        // Check parent directory
        this._removeEmptyParentDirs(path.dirname(dir));
      }
    } catch {
      // Ignore error
    }
  }

  /**
   * Get relative path from base directory given an absolute path
   * @param {string} absolutePath - Absolute path
   * @returns {string} Relative path (`/` delimited)
   * @private
   */
  _getRelativePath(absolutePath) {
    return path.relative(this._audioConfig.recordingsDir, absolutePath).replace(/\\/g, '/');
  }

  /**
   * Release resources
   */
  destroy() {
    this.stopRecording();
    this.removeAllListeners();
  }
}

/**
 * Format bytes into human-readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted size string
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

module.exports = AudioRecorder;
