/**
 * @fileoverview BCT15X scanner state management
 * @description Manages current scanner status and reception history log.
 */

const EventEmitter = require('events');

/**
 * Scanner state management class
 * @extends EventEmitter
 * @fires ScannerState#receptionStart - On reception start
 * @fires ScannerState#receptionEnd - On reception end
 * @fires ScannerState#statusUpdate - On status update
 */
class ScannerState extends EventEmitter {
  /**
   * @param {Object} config - Configuration object
   * @param {number} config.receptionTimeoutMs - Timeout (ms) to determine end of reception
   * @param {number} config.maxLogEntries - Maximum number of log entries to retain
   */
  constructor(config) {
    super();

    /** @type {Object} Scanner configuration */
    this._config = config;

    /** @type {boolean} Serial port connection status */
    this.isConnected = false;

    /** @type {string} Model name */
    this.model = '';

    /** @type {string} Firmware version */
    this.firmwareVersion = '';

    /** @type {boolean} Reception in-progress flag */
    this.isReceiving = false;

    /** @type {Object|null} Current reception metadata */
    this.currentReception = null;

    /** @type {number} Current RSSI value */
    this.rssi = 0;

    /** @type {Object|null} Latest STS response */
    this.latestSts = null;

    /** @type {Array<Object>} Reception history log */
    this._receptionLog = [];

    /** @type {number|null} Reception end determination timer */
    this._receptionTimeout = null;

    /** @type {Date|null} Current reception start time */
    this._receptionStartTime = null;

    /** @type {boolean} Recording in-progress flag */
    this.isRecording = false;

    /** @type {boolean} Auto-recording enabled flag */
    this.autoRecordEnabled = true;

    /** @type {number} Maximum consecutive reception duration in seconds before forcing scan resume (0 = disabled/OFF) */
    this.maxReceptionDurationSec = (config && config.maxReceptionDurationSec) ? parseInt(config.maxReceptionDurationSec, 10) : 0;

    /** @type {boolean} Flag indicating whether scanner is in hold mode */
    this.isHoldMode = false;

    /** @type {number|null} Timer for maximum consecutive reception duration */
    this._maxDurationTimer = null;
  }

  /**
   * Update state based on GLG data
   * @param {Object} glgData - Result from parseGlgResponse
   */
  onGlgUpdate(glgData) {
    if (!glgData) {
      return;
    }

    if (glgData.isReceiving) {
      this._onSignalDetected(glgData);
    } else {
      this._onNoSignal();
    }

    this.emit('statusUpdate', this.getStatus());
  }

  /**
   * Handler when signal is detected
   * @param {Object} glgData - Parsed GLG response
   * @private
   */
  _onSignalDetected(glgData) {
    // Reset reception end timer
    this._clearReceptionTimeout();

    const isNewReception = !this.isReceiving;

    this.isReceiving = true;
    this.currentReception = {
      rawFreqTgid: glgData.rawFreqTgid,
      freqTgid: glgData.freqTgid,
      freqForFilename: glgData.freqForFilename,
      modulation: glgData.modulation,
      attenuator: glgData.attenuator,
      ctcssDcs: glgData.ctcssDcs,
      system: glgData.name1,
      department: glgData.name2,
      channel: glgData.name3,
      squelch: glgData.squelch,
      mute: glgData.mute,
      sysTag: glgData.sysTag,
      chanTag: glgData.chanTag,
      p25nac: glgData.p25nac,
    };

    if (isNewReception) {
      this._receptionStartTime = new Date();
      this._setMaxDurationTimer();

      /**
       * Reception start event
       * @event ScannerState#receptionStart
       * @type {Object}
       * @property {Object} reception - Reception metadata
       * @property {Date} startTime - Reception start time
       */
      this.emit('receptionStart', {
        reception: { ...this.currentReception },
        startTime: this._receptionStartTime,
      });
    }

    // Set reception end determination timer
    this._setReceptionTimeout();
  }

  /**
   * Handler when no signal is detected
   * @private
   */
  _onNoSignal() {
    // If timer is already running, do nothing (timeout will handle reception termination)
    if (!this.isReceiving) {
      this.currentReception = null;
      this._clearMaxDurationTimer();
    }
  }

  /**
   * Set timer for maximum consecutive reception duration
   * @private
   */
  _setMaxDurationTimer() {
    this._clearMaxDurationTimer();

    // 0 = disabled/OFF, or hold mode is active: do not force scan resume
    if (this.maxReceptionDurationSec <= 0 || this.isHoldMode) {
      return;
    }

    this._maxDurationTimer = setTimeout(() => {
      this._onMaxDurationExceeded();
    }, this.maxReceptionDurationSec * 1000);
  }

  /**
   * Clear maximum reception duration timer
   * @private
   */
  _clearMaxDurationTimer() {
    if (this._maxDurationTimer) {
      clearTimeout(this._maxDurationTimer);
      this._maxDurationTimer = null;
    }
  }

  /**
   * Handler invoked when maximum consecutive reception duration is reached
   * @private
   */
  _onMaxDurationExceeded() {
    this._clearMaxDurationTimer();

    if (!this.isReceiving || this.isHoldMode || this.maxReceptionDurationSec <= 0) {
      return;
    }

    const freq = (this.currentReception && this.currentReception.freqTgid)
      ? this.currentReception.freqTgid
      : 'current channel';
    console.log(`[ScannerState] ⏱️ Maximum reception duration (${this.maxReceptionDurationSec}s) reached on ${freq}. Requesting scan resume.`);

    /**
     * Maximum reception duration exceeded event
     * @event ScannerState#receptionMaxDurationExceeded
     * @type {Object}
     * @property {Object} reception - Current reception metadata
     * @property {number} durationSec - Configured maximum duration
     * @property {Date} startTime - Reception start time
     */
    this.emit('receptionMaxDurationExceeded', {
      reception: this.currentReception ? { ...this.currentReception } : {},
      durationSec: this.maxReceptionDurationSec,
      startTime: this._receptionStartTime,
    });
  }

  /**
   * Set reception end timeout
   * @private
   */
  _setReceptionTimeout() {
    this._clearReceptionTimeout();
    this._receptionTimeout = setTimeout(() => {
      this._onReceptionEnd();
    }, this._config.receptionTimeoutMs);
  }

  /**
   * Clear reception end timeout
   * @private
   */
  _clearReceptionTimeout() {
    if (this._receptionTimeout) {
      clearTimeout(this._receptionTimeout);
      this._receptionTimeout = null;
    }
  }

  /**
   * Handler invoked when reception concludes
   * @private
   */
  _onReceptionEnd() {
    this._clearMaxDurationTimer();

    if (!this.isReceiving) {
      return;
    }

    const endTime = new Date();
    const duration = this._receptionStartTime
      ? (endTime - this._receptionStartTime) / 1000
      : 0;

    const logEntry = {
      id: Date.now(),
      startTime: this._receptionStartTime ? this._receptionStartTime.toISOString() : null,
      endTime: endTime.toISOString(),
      durationSec: Math.round(duration * 10) / 10,
      recordingFile: null,
      ...this.currentReception,
    };

    // Add to history log
    this._receptionLog.unshift(logEntry);

    // Prune entries exceeding maximum log limit
    if (this._receptionLog.length > this._config.maxLogEntries) {
      this._receptionLog = this._receptionLog.slice(0, this._config.maxLogEntries);
    }

    /**
     * Reception end event
     * @event ScannerState#receptionEnd
     * @type {Object}
     * @property {Object} reception - Reception metadata
     * @property {Date} startTime - Reception start time
     * @property {Date} endTime - Reception end time
     * @property {number} durationSec - Reception duration in seconds
     */
    this.emit('receptionEnd', {
      reception: { ...this.currentReception },
      startTime: this._receptionStartTime,
      endTime,
      durationSec: duration,
      logEntry,
    });

    this.isReceiving = false;
    this.currentReception = null;
    this._receptionStartTime = null;

    this.emit('statusUpdate', this.getStatus());
  }

  /**
   * Attach recorded audio file path to matching or most recent log entry
   * @param {string} filename - Relative path of recording file
   * @param {number} [logEntryId] - Optional log entry ID
   * @returns {Object|null} Updated log entry
   */
  attachRecordingFile(filename, logEntryId) {
    if (!filename) return null;

    let targetEntry = null;
    if (logEntryId) {
      targetEntry = this._receptionLog.find(e => e.id === logEntryId);
    } else if (this._receptionLog.length > 0) {
      // Default to most recent entry if not yet assigned
      targetEntry = this._receptionLog.find(e => !e.recordingFile) || this._receptionLog[0];
    }

    if (targetEntry) {
      targetEntry.recordingFile = filename;
      console.log(`[ScannerState] 🔗 Attached recording "${filename}" to log entry id=${targetEntry.id}`);
      this.emit('logEntryUpdated', { logEntry: targetEntry });
      return targetEntry;
    }
    return null;
  }

  /**
   * Update RSSI value
   * @param {number} rssi - RSSI value
   */
  onRssiUpdate(rssi) {
    this.rssi = rssi;
  }

  /**
   * Update STS response data
   * @param {Object} stsData - Result from parseStsResponse
   */
  onStsUpdate(stsData) {
    this.latestSts = stsData;
  }

  /**
   * Update serial connection state
   * @param {boolean} connected - Connection status
   */
  setConnected(connected) {
    this.isConnected = connected;
    this.emit('statusUpdate', this.getStatus());
  }

  /**
   * Set scanner model name
   * @param {string} model - Model name
   */
  setModel(model) {
    this.model = model;
  }

  /**
   * Set firmware version string
   * @param {string} version - Version string
   */
  setFirmwareVersion(version) {
    this.firmwareVersion = version;
  }

  /**
   * Update recording status
   * @param {boolean} isRecording - Flag whether actively recording
   */
  setRecording(isRecording) {
    this.isRecording = isRecording;
    this.emit('statusUpdate', this.getStatus());
  }

  /**
   * Set hold mode state
   * @param {boolean} isHold - Whether scanner is in hold mode
   */
  setHoldMode(isHold) {
    this.isHoldMode = !!isHold;
    if (this.isHoldMode) {
      this._clearMaxDurationTimer();
    } else if (this.isReceiving && this.maxReceptionDurationSec > 0) {
      this._setMaxDurationTimer();
    }
    this.emit('statusUpdate', this.getStatus());
  }

  /**
   * Set maximum consecutive reception duration in seconds
   * @param {number} sec - Duration in seconds (0 = disabled/OFF)
   */
  setMaxReceptionDurationSec(sec) {
    const parsed = parseInt(sec, 10);
    this.maxReceptionDurationSec = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    console.log(`[ScannerState] ⏱️ Max reception duration set to: ${this.maxReceptionDurationSec}s`);

    if (this.maxReceptionDurationSec <= 0 || this.isHoldMode) {
      this._clearMaxDurationTimer();
    } else if (this.isReceiving) {
      this._setMaxDurationTimer();
    }
  }

  /**
   * Get current scanner status snapshot
   * @returns {Object} Status snapshot object
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      model: this.model,
      firmwareVersion: this.firmwareVersion,
      isReceiving: this.isReceiving,
      isRecording: this.isRecording,
      autoRecordEnabled: this.autoRecordEnabled,
      maxReceptionDurationSec: this.maxReceptionDurationSec,
      isHoldMode: this.isHoldMode,
      rssi: this.rssi,
      currentReception: this.currentReception ? { ...this.currentReception } : null,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get reception history log with optional filtering
   * @param {number} [limit=100] - Limit of entries to return
   * @param {number} [offset=0] - Offset for pagination
   * @param {Object} [filters={}] - Filter criteria
   * @param {string} [filters.dateFrom] - Start date/time (ISO format)
   * @param {string} [filters.dateTo] - End date/time (ISO format)
   * @param {string} [filters.freq] - Frequency/TGID (substring match)
   * @param {string} [filters.system] - System name (substring match)
   * @param {string} [filters.channel] - Channel name (substring match)
   * @param {string} [filters.modulation] - Modulation (exact match)
   * @param {number} [filters.minDuration] - Minimum duration in seconds
   * @returns {Object} Log result object
   * @property {Array<Object>} entries - Log entry array
   * @property {number} total - Total matching entries count
   * @property {number} totalUnfiltered - Total entries count before filtering
   */
  getLog(limit = 100, offset = 0, filters = {}) {
    let entries = this._receptionLog;

    // Apply filtering
    const hasFilters = Object.keys(filters).some((key) => filters[key] !== undefined && filters[key] !== '');

    if (hasFilters) {
      entries = entries.filter((entry) => {
        // Date range filter
        if (filters.dateFrom) {
          const from = new Date(filters.dateFrom);
          if (!isNaN(from.getTime()) && entry.startTime) {
            if (new Date(entry.startTime) < from) return false;
          }
        }

        if (filters.dateTo) {
          const to = new Date(filters.dateTo);
          if (!isNaN(to.getTime()) && entry.startTime) {
            if (new Date(entry.startTime) > to) return false;
          }
        }

        // Frequency/TGID filter (case-insensitive substring)
        if (filters.freq) {
          const freqLower = filters.freq.toLowerCase();
          const entryFreq = (entry.freqTgid || entry.rawFreqTgid || '').toLowerCase();
          if (!entryFreq.includes(freqLower)) return false;
        }

        // System name filter (case-insensitive substring)
        if (filters.system) {
          const systemLower = filters.system.toLowerCase();
          const entrySystem = (entry.system || '').toLowerCase();
          if (!entrySystem.includes(systemLower)) return false;
        }

        // Channel name filter (case-insensitive substring)
        if (filters.channel) {
          const channelLower = filters.channel.toLowerCase();
          const entryChannel = (entry.channel || '').toLowerCase();
          if (!entryChannel.includes(channelLower)) return false;
        }

        // Modulation filter (case-insensitive exact match)
        if (filters.modulation) {
          const modLower = filters.modulation.toLowerCase();
          const entryMod = (entry.modulation || '').toLowerCase();
          if (entryMod !== modLower) return false;
        }

        // Minimum duration filter
        if (filters.minDuration !== undefined && filters.minDuration !== '') {
          const minDur = parseFloat(filters.minDuration);
          if (!isNaN(minDur) && (entry.durationSec || 0) < minDur) return false;
        }

        return true;
      });
    }

    return {
      entries: entries.slice(offset, offset + limit),
      total: entries.length,
      totalUnfiltered: this._receptionLog.length,
    };
  }

  /**
   * Clear all reception history logs
   */
  clearLog() {
    this._receptionLog = [];
  }

  /**
   * Release resources
   */
  destroy() {
    this._clearReceptionTimeout();
    this.removeAllListeners();
  }
}

module.exports = ScannerState;
