/**
 * @fileoverview Recording Store and Storage Management Module
 * @description Provides a hybrid data store abstraction for recordings:
 * - High-speed metadata indexing with automatic disk reconciliation (detects files deleted externally)
 * - Automatic retention policy enforcement (removes files older than N days or exceeding storage quota)
 * - Multi-dimensional hierarchical filtering and tag extraction
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class RecordingStore extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} options.recordingsDir - Base directory for recordings
   * @param {Object} [options.retention] - Storage retention configuration
   * @param {number} [options.retention.retentionDays=30] - Max retention days (0 = unlimited)
   * @param {number} [options.retention.maxStorageMb=0] - Max storage size in MB (0 = unlimited)
   * @param {number} [options.retention.cleanupIntervalHours=12] - Cleanup job interval
   */
  constructor(options) {
    super();

    this._recordingsDir = options.recordingsDir;
    this._retentionConfig = options.retention || {
      retentionDays: 30,
      maxStorageMb: 0,
      cleanupIntervalHours: 12,
    };

    /** @type {Map<string, Object>} In-memory index of recordings keyed by relativePath */
    this._index = new Map();

    /** @type {string} Path to persistent index cache */
    this._indexPath = path.join(this._recordingsDir, '.index.json');

    /** @type {NodeJS.Timeout|null} Scheduled cleanup timer */
    this._cleanupTimer = null;

    /** @type {Promise<void>|null} Active disk reconciliation */
    this._reconcilePromise = null;

    /** @type {boolean} Whether disk reconciliation is running */
    this._isReconciling = false;

    /** @type {Map<string, Object|null>} Index changes made during reconciliation */
    this._pendingIndexChanges = new Map();

    /** @type {boolean} Whether the store has been destroyed */
    this._destroyed = false;

    // Serve the cached index immediately while disk reconciliation runs asynchronously
    this._ensureDir();
    this._loadIndex();
    this._startCleanupJob();
    this.reconcile().catch((err) => {
      console.error('[RecordingStore] Background reconciliation failed:', err.message);
    });
  }

  /**
   * Ensure storage directory exists
   * @private
   */
  _ensureDir() {
    if (!fs.existsSync(this._recordingsDir)) {
      fs.mkdirSync(this._recordingsDir, { recursive: true });
    }
  }

  /**
   * Load the persisted index without scanning recording files
   * @private
   */
  _loadIndex() {
    try {
      const records = JSON.parse(fs.readFileSync(this._indexPath, 'utf8'));
      if (!Array.isArray(records)) {
        throw new Error('Index cache is not an array');
      }

      this._index = new Map(
        records
          .filter((record) => record && typeof record.filename === 'string')
          .map((record) => [record.filename, record])
      );
      console.log(`[RecordingStore] Loaded index cache: ${this._index.size} recordings`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[RecordingStore] Failed to load index cache; rebuilding from disk:', err.message);
      }
    }
  }

  /**
   * Reconcile memory index with physical disk storage without blocking HTTP requests.
   * Changes made through add/delete during the scan are applied to the final index.
   * @returns {Promise<void>}
   */
  async reconcile() {
    if (this._reconcilePromise) {
      return this._reconcilePromise;
    }

    this._isReconciling = true;
    this._pendingIndexChanges.clear();
    this._reconcilePromise = this._reconcileWithDisk();

    try {
      await this._reconcilePromise;
    } finally {
      this._reconcilePromise = null;
      this._isReconciling = false;
      this._pendingIndexChanges.clear();
    }
  }

  /**
   * Scan audio files with bounded asynchronous I/O
   * @returns {Promise<void>}
   * @private
   */
  async _reconcileWithDisk() {
    this._ensureDir();

    const audioExtensions = new Set(['.mp3', '.wav', '.ogg', '.flac']);
    const audioFiles = [];

    const scanDir = async (currentDir) => {
      let entries;
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) {
          audioFiles.push(fullPath);
        }
      }

      if (this._destroyed) return;
    };

    await scanDir(this._recordingsDir);
    if (this._destroyed) return;

    const diskFiles = new Map();
    let nextIndex = 0;
    const workerCount = Math.min(16, audioFiles.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < audioFiles.length && !this._destroyed) {
        const fullPath = audioFiles[nextIndex++];
        try {
          const record = await this._readRecordingRecord(fullPath);
          diskFiles.set(record.filename, record);
        } catch {
          // Ignore unreadable files
        }
      }
    });
    await Promise.all(workers);
    if (this._destroyed) return;

    for (const [filename, record] of this._pendingIndexChanges) {
      if (record === null) {
        diskFiles.delete(filename);
      } else {
        diskFiles.set(filename, record);
      }
    }

    this._index = diskFiles;
    this._persistIndex();
    console.log(`[RecordingStore] Reconciled index: ${this._index.size} recordings active`);
  }

  /**
   * Read one audio file and its optional sidecar metadata
   * @param {string} fullPath - Absolute audio file path
   * @returns {Promise<Object>} Recording index record
   * @private
   */
  async _readRecordingRecord(fullPath) {
    const relativePath = path.relative(this._recordingsDir, fullPath).replace(/\\/g, '/');
    const jsonPath = fullPath.replace(/\.[^.]+$/, '.json');
    const [stat, metadataText] = await Promise.all([
      fs.promises.stat(fullPath),
      fs.promises.readFile(jsonPath, 'utf8').catch(() => null),
    ]);

    let meta = null;
    if (metadataText) {
      try {
        meta = JSON.parse(metadataText);
      } catch {
        // Ignore parse error
      }
    }

    let system = meta ? meta.system : '';
    let department = meta ? meta.department : '';
    let channel = meta ? meta.channel : '';
    let frequency = meta ? meta.frequency : '';
    let modulation = meta ? meta.modulation : '';
    const durationSec = meta && meta.durationSec !== undefined ? meta.durationSec : null;

    if (!meta) {
      const parts = relativePath.split('/');
      if (parts.length >= 4) {
        system = parts[0];
        department = parts[1];
        channel = parts[2];
      } else if (parts.length === 3) {
        system = parts[0];
        channel = parts[1];
      }
    }

    return {
      filename: relativePath,
      size: stat.size,
      sizeFormatted: formatFileSize(stat.size),
      createdAt: meta && meta.startTime ? meta.startTime : stat.birthtime.toISOString(),
      modifiedAt: meta && meta.endTime ? meta.endTime : stat.mtime.toISOString(),
      durationSec,
      system: system || 'General',
      department: department || 'Default',
      channel: channel || 'Ch',
      frequency: frequency || '',
      modulation: modulation || '',
      meta: meta || null,
    };
  }

  /**
   * Preserve an index mutation made while a disk scan is in progress
   * @param {string} filename - Relative recording path
   * @param {Object|null} record - New record, or null when deleted
   * @private
   */
  _recordIndexChange(filename, record) {
    if (this._isReconciling) {
      this._pendingIndexChanges.set(filename, record);
    }
  }

  /**
   * Persist in-memory index to disk
   * @private
   */
  _persistIndex() {
    try {
      const serialized = JSON.stringify(Array.from(this._index.values()), null, 2);
      fs.writeFileSync(this._indexPath, serialized, 'utf8');
    } catch {
      // Ignore write errors to cache
    }
  }

  /**
   * Add a newly completed recording to store
   * @param {Object} recordingRecord
   */
  add(recordingRecord) {
    this._index.set(recordingRecord.filename, recordingRecord);
    this._recordIndexChange(recordingRecord.filename, recordingRecord);
    this._persistIndex();
    this.emit('recordingAdded', recordingRecord);
  }

  /**
   * Retrieve recordings from the in-memory index with multi-dimensional filtering
   * Physical files are validated during reconciliation and when opened for playback.
   * @param {Object} [filters={}]
   * @param {'asc'|'desc'} [filters.sortOrder='desc'] - Creation date sort order
   * @returns {Array<Object>}
   */
  query(filters = {}) {
    let filtered = Array.from(this._index.values());

    // Handle date presets and custom ranges
    const now = new Date();
    if (filters.datePreset && filters.datePreset !== 'custom') {
      if (filters.datePreset === 'today') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filtered = filtered.filter((f) => new Date(f.createdAt) >= startOfToday);
      } else if (filters.datePreset === 'yesterday') {
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, -1);
        filtered = filtered.filter((f) => {
          const d = new Date(f.createdAt);
          return d >= startOfYesterday && d <= endOfYesterday;
        });
      } else if (filters.datePreset === '24h') {
        const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        filtered = filtered.filter((f) => new Date(f.createdAt) >= past24h);
      } else if (filters.datePreset === '7d') {
        const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter((f) => new Date(f.createdAt) >= past7d);
      }
    }

    // Specific date range (from / to)
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

    // System filter
    if (filters.system) {
      const sysLower = filters.system.toLowerCase();
      filtered = filtered.filter((f) => (f.system || '').toLowerCase().includes(sysLower));
    }

    // Department filter
    if (filters.department) {
      const deptLower = filters.department.toLowerCase();
      filtered = filtered.filter((f) => (f.department || '').toLowerCase().includes(deptLower));
    }

    // Channel filter
    if (filters.channel) {
      const chnLower = filters.channel.toLowerCase();
      filtered = filtered.filter((f) => (f.channel || '').toLowerCase().includes(chnLower));
    }

    // Minimum duration filter
    if (filters.minDuration !== undefined && filters.minDuration !== '') {
      const minDur = parseFloat(filters.minDuration);
      if (!isNaN(minDur)) {
        filtered = filtered.filter((f) => (f.durationSec || 0) >= minDur);
      }
    }

    // Keyword search
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter((f) =>
        f.filename.toLowerCase().includes(searchLower) ||
        (f.system || '').toLowerCase().includes(searchLower) ||
        (f.channel || '').toLowerCase().includes(searchLower) ||
        (f.department || '').toLowerCase().includes(searchLower)
      );
    }

    // Sort by creation date in the same order used by API pagination
    const direction = filters.sortOrder === 'asc' ? 1 : -1;
    filtered.sort((a, b) => direction * (new Date(a.createdAt) - new Date(b.createdAt)));

    return filtered;
  }

  /**
   * Get unique systems, departments, channels, and their hierarchical relationship
   * @returns {Object} { systems: string[], departments: string[], channels: string[], hierarchy: Object }
   */
  getTags() {
    const list = Array.from(this._index.values());
    const systems = new Set();
    const departments = new Set();
    const channels = new Set();
    const hierarchy = {};

    for (const item of list) {
      const sys = (item.system && item.system.trim()) || '';
      const dept = (item.department && item.department.trim()) || '';
      const chn = (item.channel && item.channel.trim()) || '';

      if (sys) systems.add(sys);
      if (dept) departments.add(dept);
      if (chn) channels.add(chn);

      if (sys) {
        if (!hierarchy[sys]) {
          hierarchy[sys] = {};
        }
        if (dept) {
          if (!hierarchy[sys][dept]) {
            hierarchy[sys][dept] = new Set();
          }
          if (chn) {
            hierarchy[sys][dept].add(chn);
          }
        }
      }
    }

    // Convert Sets in hierarchy to sorted arrays
    const hierarchyObj = {};
    for (const sys of Object.keys(hierarchy)) {
      hierarchyObj[sys] = {};
      for (const dept of Object.keys(hierarchy[sys])) {
        hierarchyObj[sys][dept] = Array.from(hierarchy[sys][dept]).sort();
      }
    }

    return {
      systems: Array.from(systems).sort(),
      departments: Array.from(departments).sort(),
      channels: Array.from(channels).sort(),
      hierarchy: hierarchyObj,
    };
  }

  /**
   * Delete a recording file, its sidecar JSON, and its index entry
   * @param {string} relativePath
   * @returns {boolean} True if deleted
   */
  delete(relativePath) {
    const normalized = path.normalize(relativePath).replace(/\\/g, '/');
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      return false;
    }

    const filePath = path.join(this._recordingsDir, normalized);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`[RecordingStore] Failed to delete file:`, err.message);
        return false;
      }

      // Delete sidecar JSON
      const jsonPath = filePath.replace(/\.[^.]+$/, '.json');
      if (fs.existsSync(jsonPath)) {
        try {
          fs.unlinkSync(jsonPath);
        } catch {
          // Ignore
        }
      }

      // Remove empty parent directories
      this._removeEmptyDirs(path.dirname(filePath));

      // Remove from index
      this._index.delete(normalized);
      this._recordIndexChange(normalized, null);
      this._persistIndex();

      this.emit('recordingDeleted', { filename: normalized });
      return true;
    }

    // Even if physical file was already missing, remove from index
    if (this._index.has(normalized)) {
      this._index.delete(normalized);
      this._recordIndexChange(normalized, null);
      this._persistIndex();
      return true;
    }

    return false;
  }

  /**
   * Remove empty parent directories up to recordings root
   * @param {string} dir
   * @private
   */
  _removeEmptyDirs(dir) {
    const baseDir = path.resolve(this._recordingsDir);
    const resolvedDir = path.resolve(dir);

    if (resolvedDir === baseDir || !resolvedDir.startsWith(baseDir)) {
      return;
    }

    try {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        this._removeEmptyDirs(path.dirname(dir));
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Execute automatic storage retention policy:
   * 1. Delete files exceeding retentionDays
   * 2. Delete oldest files if total storage exceeds maxStorageMb
   * @returns {Object} Cleanup summary { deletedCount, freedBytes }
   */
  cleanExpired() {
    const retentionDays = this._retentionConfig.retentionDays || 0;
    const maxStorageMb = this._retentionConfig.maxStorageMb || 0;

    let deletedCount = 0;
    let freedBytes = 0;

    const list = Array.from(this._index.values());
    const now = Date.now();

    // 1. Age-based cleanup
    if (retentionDays > 0) {
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
      for (const item of list) {
        const itemDate = new Date(item.createdAt).getTime();
        if (now - itemDate > maxAgeMs) {
          freedBytes += item.size || 0;
          if (this.delete(item.filename)) {
            deletedCount++;
          }
        }
      }
    }

    // 2. Storage quota cleanup
    if (maxStorageMb > 0) {
      const maxBytes = maxStorageMb * 1024 * 1024;
      let remaining = Array.from(this._index.values());
      let totalBytes = remaining.reduce((acc, f) => acc + (f.size || 0), 0);

      if (totalBytes > maxBytes) {
        // Sort oldest first
        remaining.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        for (const item of remaining) {
          if (totalBytes <= maxBytes) break;
          const itemSize = item.size || 0;
          if (this.delete(item.filename)) {
            deletedCount++;
            freedBytes += itemSize;
            totalBytes -= itemSize;
          }
        }
      }
    }

    if (deletedCount > 0) {
      console.log(`[RecordingStore] Retention cleanup: removed ${deletedCount} files, freed ${formatFileSize(freedBytes)}`);
    }

    return { deletedCount, freedBytes };
  }

  /**
   * Start scheduled background cleanup job
   * @private
   */
  _startCleanupJob() {
    const hours = this._retentionConfig.cleanupIntervalHours || 12;
    const intervalMs = hours * 60 * 60 * 1000;

    this._cleanupTimer = setInterval(() => {
      try {
        this.cleanExpired();
      } catch (err) {
        console.error('[RecordingStore] Error during scheduled retention cleanup:', err.message);
      }
    }, intervalMs);
  }

  /**
   * Destroy and clean up resources
   */
  destroy() {
    this._destroyed = true;
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this.removeAllListeners();
  }
}

/**
 * Format bytes into human-readable size
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

module.exports = RecordingStore;
