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

    // Initialize store
    this._ensureDir();
    this.reconcile();
    this._startCleanupJob();
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
   * Reconcile memory index with physical disk storage.
   * - Scans disk for audio files and sidecar JSONs
   * - Removes missing entries from index if files were deleted externally
   * - Registers any newly added files
   */
  reconcile() {
    this._ensureDir();

    const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac'];
    const diskFiles = new Map();

    // Recursive directory traversal
    const scanDir = (currentDir) => {
      let entries;
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // Skip hidden files/directories (.index.json, etc.)

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (audioExtensions.includes(ext)) {
            try {
              const stat = fs.statSync(fullPath);
              const relativePath = path.relative(this._recordingsDir, fullPath).replace(/\\/g, '/');

              // Sidecar JSON check
              const jsonPath = fullPath.replace(/\.[^.]+$/, '.json');
              let meta = null;
              if (fs.existsSync(jsonPath)) {
                try {
                  meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                } catch {
                  // Ignore parse error
                }
              }

              // Fallback parse from folder hierarchy
              let system = meta ? meta.system : '';
              let department = meta ? meta.department : '';
              let channel = meta ? meta.channel : '';
              let frequency = meta ? meta.frequency : '';
              let modulation = meta ? meta.modulation : '';
              let durationSec = meta && meta.durationSec !== undefined ? meta.durationSec : null;

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

              diskFiles.set(relativePath, {
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
              });
            } catch {
              // Ignore unreadable files
            }
          }
        }
      }
    };

    scanDir(this._recordingsDir);

    // Update in-memory index
    this._index = diskFiles;
    this._persistIndex();

    console.log(`[RecordingStore] Reconciled index: ${this._index.size} recordings active`);
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
    this._persistIndex();
    this.emit('recordingAdded', recordingRecord);
  }

  /**
   * Retrieve list of recordings with multi-dimensional filtering
   * Automatically validates file existence to prune externally deleted files on the fly.
   * @param {Object} [filters={}]
   * @returns {Array<Object>}
   */
  query(filters = {}) {
    const list = Array.from(this._index.values());
    const validList = [];
    let prunedCount = 0;

    // Verify physical existence to catch external deletes
    for (const item of list) {
      const fullPath = path.join(this._recordingsDir, item.filename);
      if (fs.existsSync(fullPath)) {
        validList.push(item);
      } else {
        // File was removed externally from disk
        this._index.delete(item.filename);
        prunedCount++;
      }
    }

    if (prunedCount > 0) {
      this._persistIndex();
      console.log(`[RecordingStore] Pruned ${prunedCount} externally deleted recordings from index`);
    }

    let filtered = validList;

    // Handle date presets
    const now = new Date();
    if (filters.datePreset) {
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
    } else {
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

    // Sort descending by creation date
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return filtered;
  }

  /**
   * Get unique systems, departments, and channels across all active recordings
   * @returns {Object} { systems: string[], departments: string[], channels: string[] }
   */
  getTags() {
    const list = Array.from(this._index.values());
    const systems = new Set();
    const departments = new Set();
    const channels = new Set();

    for (const item of list) {
      if (item.system && item.system.trim()) systems.add(item.system.trim());
      if (item.department && item.department.trim()) departments.add(item.department.trim());
      if (item.channel && item.channel.trim()) channels.add(item.channel.trim());
    }

    return {
      systems: Array.from(systems).sort(),
      departments: Array.from(departments).sort(),
      channels: Array.from(channels).sort(),
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
      this._persistIndex();

      this.emit('recordingDeleted', { filename: normalized });
      return true;
    }

    // Even if physical file was already missing, remove from index
    if (this._index.has(normalized)) {
      this._index.delete(normalized);
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
