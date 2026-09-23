/**
 * @fileoverview Low-latency PCM Streaming Audio Player
 * @description Streams raw PCM audio over WebSocket using Web Audio API (AudioContext).
 * Achieves sub-second latency (100-300ms) with automatic drift compensation and gapless scheduling.
 */

/**
 * AudioPlayer class using Web Audio API
 */
class AudioPlayer {
  /**
   * @param {Object} [options]
   * @param {number} [options.sampleRate=16000] - Audio sample rate in Hz
   * @param {number} [options.channels=1] - Channel count (1 = mono)
   * @param {number} [options.bufferLatencySec=0.06] - Target jitter buffer safety margin (seconds)
   * @param {number} [options.maxLatencySec=0.25] - Max tolerated latency before drift reset (seconds)
   * @param {Function} [options.onStateChange] - Callback for playback state and status changes
   * @param {Function} [options.onError] - Callback for playback errors
   */
  constructor(options = {}) {
    /** @type {number} */
    this._sampleRate = options.sampleRate || 16000;

    /** @type {number} */
    this._channels = options.channels || 1;

    /** @type {number} Safety buffer margin in seconds */
    this._bufferLatencySec = options.bufferLatencySec || 0.06;

    /** @type {number} Max allowed buffer delay before resetting to live edge */
    this._maxLatencySec = options.maxLatencySec || 0.25;

    /** @type {Function|null} */
    this._onStateChange = options.onStateChange || null;

    /** @type {Function|null} */
    this._onError = options.onError || null;

    /** @type {AudioContext|null} */
    this._audioCtx = null;

    /** @type {GainNode|null} */
    this._gainNode = null;

    /** @type {WebSocket|null} */
    this._ws = null;

    /** @type {number} Next scheduled audio start time in AudioContext timeline */
    this._nextPlayTime = 0;

    /** @type {boolean} Whether playback is intended to be active */
    this._isPlaying = false;

    /** @type {number|null} Reconnection timer ID */
    this._reconnectTimer = null;

    /** @type {number} Current volume (0.0 to 1.0) */
    this._volume = 0.8;
  }

  /**
   * Check whether audio streaming is currently active
   * @returns {boolean}
   */
  isPlaying() {
    return this._isPlaying;
  }

  /**
   * Get current volume (0 to 100)
   * @returns {number}
   */
  getVolume() {
    return Math.round(this._volume * 100);
  }

  /**
   * Set playback volume
   * @param {number} vol - Volume level (0 to 100)
   */
  setVolume(vol) {
    const clamped = Math.max(0, Math.min(100, vol));
    this._volume = clamped / 100;

    if (this._gainNode && this._audioCtx) {
      try {
        this._gainNode.gain.setValueAtTime(this._volume, this._audioCtx.currentTime);
      } catch {
        this._gainNode.gain.value = this._volume;
      }
    }
  }

  /**
   * Initialize AudioContext and GainNode
   * Must be called during or after user interaction to satisfy browser autoplay policies.
   * @private
   */
  _ensureAudioContext() {
    if (!this._audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new AudioContextClass();

      this._gainNode = this._audioCtx.createGain();
      this._gainNode.gain.value = this._volume;
      this._gainNode.connect(this._audioCtx.destination);
    }

    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }
  }

  /**
   * Start live audio playback
   * @param {string} [token] - Optional authentication token
   */
  start(token) {
    if (this._isPlaying) {
      return;
    }

    this._isPlaying = true;
    this._clearReconnectTimer();
    this._ensureAudioContext();

    this._notifyState(true, this._getI18nText('scanner.liveAudioConnecting', '接続中...'));
    this._connectWebSocket(token);
  }

  /**
   * Stop live audio playback
   */
  stop() {
    this._isPlaying = false;
    this._clearReconnectTimer();

    if (this._ws) {
      try {
        this._ws.onclose = null;
        this._ws.onerror = null;
        this._ws.onmessage = null;
        this._ws.close();
      } catch {
        // Ignore close error
      }
      this._ws = null;
    }

    this._nextPlayTime = 0;
    this._notifyState(false, this._getI18nText('scanner.liveAudioStatusStopped', '停止中'));
    console.log('[AudioPlayer] Live audio stopped');
  }

  /**
   * Connect to audio streaming WebSocket endpoint
   * @param {string} [token] - Optional authentication token
   * @private
   */
  _connectWebSocket(token) {
    if (!this._isPlaying) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/ws/audio`;

    const authToken = token || (typeof app !== 'undefined' && app.getAuthToken ? app.getAuthToken() : null);
    if (authToken) {
      wsUrl += `?token=${encodeURIComponent(authToken)}`;
    }

    try {
      this._ws = new WebSocket(wsUrl);
      this._ws.binaryType = 'arraybuffer';

      this._ws.onopen = () => {
        console.log('[AudioPlayer] WebSocket connected');
        this._nextPlayTime = 0;
        this._notifyState(true);
      };

      this._ws.onmessage = (event) => {
        this._onAudioChunkReceived(event.data);
      };

      this._ws.onerror = (err) => {
        console.error('[AudioPlayer] WebSocket error:', err);
      };

      this._ws.onclose = (event) => {
        console.log(`[AudioPlayer] WebSocket closed: code=${event.code}`);
        this._ws = null;

        if (this._isPlaying) {
          const retryMsg = this._getI18nText('scanner.liveAudioConnecting', '再接続中...');
          this._notifyState(true, retryMsg);

          this._reconnectTimer = setTimeout(() => {
            if (this._isPlaying) {
              this._connectWebSocket(token);
            }
          }, 2000);
        }
      };
    } catch (err) {
      console.error('[AudioPlayer] Failed to create WebSocket:', err.message);
      if (this._onError) {
        this._onError(err);
      }
    }
  }

  /**
   * Process and schedule incoming raw PCM chunk
   * @param {ArrayBuffer} buffer - 16-bit signed integer PCM data
   * @private
   */
  _onAudioChunkReceived(buffer) {
    if (!this._isPlaying || !this._audioCtx || !(buffer instanceof ArrayBuffer)) {
      return;
    }

    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }

    const int16Array = new Int16Array(buffer);
    const numSamples = int16Array.length;
    if (numSamples === 0) {
      return;
    }

    // Create AudioBuffer at sampleRate (browser automatically resamples to hardware destination)
    const audioBuffer = this._audioCtx.createBuffer(this._channels, numSamples, this._sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    // Convert Int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
    for (let i = 0; i < numSamples; i++) {
      channelData[i] = int16Array[i] / 32768.0;
    }

    const now = this._audioCtx.currentTime;

    // Buffer underrun or initial frame: schedule with safety margin
    if (this._nextPlayTime < now) {
      this._nextPlayTime = now + this._bufferLatencySec;
    }

    // Buffer accumulation / latency drift check:
    // If queued audio extends beyond maxLatencySec, catch up immediately to maintain real-time sync
    if (this._nextPlayTime - now > this._maxLatencySec) {
      this._nextPlayTime = now + this._bufferLatencySec;
    }

    const source = this._audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this._gainNode);
    source.start(this._nextPlayTime);

    this._nextPlayTime += audioBuffer.duration;
  }

  /**
   * Clear reconnection timer
   * @private
   */
  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  /**
   * Notify state change
   * @param {boolean} isPlaying
   * @param {string} [statusText]
   * @private
   */
  _notifyState(isPlaying, statusText) {
    if (this._onStateChange) {
      this._onStateChange(isPlaying, statusText);
    }
  }

  /**
   * Helper to retrieve i18n text if available
   * @param {string} key
   * @param {string} fallback
   * @returns {string}
   * @private
   */
  _getI18nText(key, fallback) {
    if (typeof i18n !== 'undefined' && i18n.t) {
      return i18n.t(key);
    }
    return fallback;
  }
}

// Global exposure
window.AudioPlayer = AudioPlayer;
