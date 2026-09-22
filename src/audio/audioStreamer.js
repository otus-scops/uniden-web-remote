/**
 * @fileoverview Live audio streaming & recording integration module
 * @description Captures audio using SOX, supporting both HTTP streaming distribution
 * and recording to disk. Splits single SOX process output into multiple streams.
 */

const EventEmitter = require('events');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const fs = require('fs');

/**
 * Live audio streaming & recording integrated controller class
 * Captures audio via SOX, distributes MP3 stream to multiple connected clients,
 * and simultaneously records to files.
 * @extends EventEmitter
 * @fires AudioStreamer#clientConnected - On client connection
 * @fires AudioStreamer#clientDisconnected - On client disconnection
 * @fires AudioStreamer#streamStart - On stream start
 * @fires AudioStreamer#streamStop - On stream stop
 * @fires AudioStreamer#streamError - On stream error
 * @fires AudioStreamer#recordingPipeStart - On recording pipe start
 * @fires AudioStreamer#recordingPipeStop - On recording pipe stop
 */
class AudioStreamer extends EventEmitter {
  /**
   * @param {Object} audioConfig - Audio configuration
   * @param {string} audioConfig.device - ALSA device name (e.g. "hw:1,0")
   * @param {number} audioConfig.sampleRate - Sample rate
   * @param {number} audioConfig.channels - Channel count
   * @param {number} audioConfig.mp3Bitrate - MP3 bitrate in kbps
   * @param {boolean} [mockMode=false] - Mock mode flag
   */
  constructor(audioConfig, mockMode = false) {
    super();

    /** @type {Object} Audio configuration */
    this._audioConfig = audioConfig;

    /** @type {boolean} Mock mode flag */
    this._mockMode = mockMode;

    /** @type {import('child_process').ChildProcess|null} SOX process */
    this._soxProcess = null;

    /** @type {boolean} Streaming in-progress flag */
    this._isStreaming = false;

    /** @type {Set<PassThrough>} Connected client streams */
    this._clients = new Set();

    /** @type {number|null} Mock streaming interval timer */
    this._mockTimer = null;

    /** @type {Buffer|null} Mock MP3 silence frame */
    this._mockSilenceFrame = null;

    /** @type {boolean} Flag indicating intentional stop to prevent close event race conditions */
    this._intentionalStop = false;

    /** @type {Promise<void>|null} Promise tracking SOX process exit */
    this._stopPromise = null;

    /** @type {fs.WriteStream|null} Recording file write stream */
    this._recordingStream = null;

    /** @type {string|null} Current recording file path */
    this._recordingFilePath = null;

    /** @type {boolean} Recording in-progress flag */
    this._isRecording = false;
  }

  /**
   * Check whether streaming is active
   * @returns {boolean}
   */
  isStreaming() {
    return this._isStreaming;
  }

  /**
   * Check whether recording is active
   * @returns {boolean}
   */
  isRecording() {
    return this._isRecording;
  }

  /**
   * Get connected client count
   * @returns {number}
   */
  getClientCount() {
    return this._clients.size;
  }

  /**
   * Create a new client stream and begin audio distribution.
   * Spawns SOX process if not already running.
   * @returns {PassThrough} Readable stream for the client
   */
  addClient() {
    const clientStream = new PassThrough();

    this._clients.add(clientStream);

    // Remove from set when client stream closes
    clientStream.on('close', () => {
      this._removeClient(clientStream);
    });

    clientStream.on('error', () => {
      this._removeClient(clientStream);
    });

    console.log(`[AudioStreamer] Client connected (current: ${this._clients.size})`);
    this.emit('clientConnected', { clientCount: this._clients.size });

    // Start streaming if not already running
    if (!this._isStreaming) {
      this._startStreaming();
    }

    return clientStream;
  }

  /**
   * Remove a client stream
   * @param {PassThrough} clientStream - Stream to remove
   * @private
   */
  _removeClient(clientStream) {
    if (!this._clients.has(clientStream)) {
      return;
    }

    this._clients.delete(clientStream);
    console.log(`[AudioStreamer] Client disconnected (remaining: ${this._clients.size})`);
    this.emit('clientDisconnected', { clientCount: this._clients.size });

    // Stop streaming if all clients disconnected and not currently recording
    if (this._clients.size === 0 && !this._isRecording) {
      this._stopStreaming();
    }
  }

  /**
   * Start recording pipe (write SOX output to file)
   * Spawns SOX process if not already running.
   * @param {string} filePath - Recording file path
   */
  startRecordingPipe(filePath) {
    if (this._isRecording) {
      console.log('[AudioStreamer] Recording pipe already active. Stopping previous pipe first.');
      this.stopRecordingPipe();
    }

    this._recordingFilePath = filePath;

    try {
      this._recordingStream = fs.createWriteStream(filePath);
      this._isRecording = true;

      this._recordingStream.on('error', (err) => {
        console.error(`[AudioStreamer] Recording file write error:`, err.message);
        this.stopRecordingPipe();
      });

      console.log(`[AudioStreamer] Recording pipe started: ${filePath}`);
      this.emit('recordingPipeStart', { filePath });

      // Start SOX process if not already running
      if (!this._isStreaming) {
        this._startStreaming();
      }
    } catch (err) {
      console.error(`[AudioStreamer] Recording pipe start failed:`, err.message);
      this._isRecording = false;
      this._recordingStream = null;
      this._recordingFilePath = null;
    }
  }

  /**
   * Stop recording pipe (terminate file writing)
   * @returns {Object|null} Recording outcome metadata
   */
  stopRecordingPipe() {
    if (!this._isRecording) {
      return null;
    }

    const filePath = this._recordingFilePath;

    // Close file stream
    if (this._recordingStream) {
      try {
        this._recordingStream.end();
      } catch (err) {
        console.error(`[AudioStreamer] Recording stream close error:`, err.message);
      }
      this._recordingStream = null;
    }

    this._isRecording = false;
    this._recordingFilePath = null;

    console.log(`[AudioStreamer] Recording pipe stopped: ${filePath}`);
    this.emit('recordingPipeStop', { filePath });

    // Stop SOX process if all clients are also disconnected
    if (this._clients.size === 0) {
      this._stopStreaming();
    }

    return { filePath };
  }

  /**
   * Start streaming (spawns SOX process)
   * If previous SOX process is shutting down, awaits completion before spawning.
   * @private
   */
  async _startStreaming() {
    if (this._isStreaming) {
      return;
    }

    // Wait for previous SOX process to terminate
    if (this._stopPromise) {
      console.log('[AudioStreamer] Awaiting previous SOX process termination...');
      try {
        await this._stopPromise;
      } catch {
        // Ignore and proceed
      }
      this._stopPromise = null;
    }

    if (this._mockMode) {
      this._startMockStreaming();
      return;
    }

    this._startSoxStreaming();
  }

  /**
   * Start real audio streaming via SOX
   * @private
   */
  _startSoxStreaming() {
    const args = this._buildSoxStreamArgs();

    console.log(`[AudioStreamer] Starting SOX streaming: sox ${args.join(' ')}`);

    try {
      this._intentionalStop = false;

      this._soxProcess = spawn('sox', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this._isStreaming = true;

      // Read MP3 data from SOX stdout and broadcast to all clients and recording stream
      this._soxProcess.stdout.on('data', (chunk) => {
        this._broadcastChunk(chunk);
      });

      this._soxProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        // Filter out normal SOX progress indicators
        if (msg && !msg.includes('In:') && !msg.includes('Input File')) {
          console.log(`[AudioStreamer] SOX: ${msg}`);
        }
      });

      this._soxProcess.on('error', (err) => {
        console.error(`[AudioStreamer] SOX process error:`, err.message);
        this._isStreaming = false;
        this.emit('streamError', { error: err.message });
        this._closeAllClients();
      });

      this._soxProcess.on('close', (code) => {
        console.log(`[AudioStreamer] SOX process exited: code=${code}`);
        this._isStreaming = false;
        this._soxProcess = null;

        // Do not restart on intentional stop
        if (this._intentionalStop) {
          return;
        }

        // On abnormal termination, attempt restart if clients or recordings still active
        if (code !== 0 && (this._clients.size > 0 || this._isRecording)) {
          console.log('[AudioStreamer] SOX process exited unexpectedly. Restarting in 3 seconds...');
          setTimeout(() => {
            if (this._clients.size > 0 || this._isRecording) {
              this._startStreaming();
            }
          }, 3000);
        }
      });

      this.emit('streamStart');
    } catch (err) {
      console.error(`[AudioStreamer] SOX streaming start failed:`, err.message);
      this._isStreaming = false;
      this.emit('streamError', { error: err.message });
    }
  }

  /**
   * Build SOX command arguments
   * @returns {string[]} SOX command line arguments
   * @private
   */
  _buildSoxStreamArgs() {
    const config = this._audioConfig;
    const args = [];

    // Input audio device
    if (config.device && config.device !== 'default') {
      args.push('-t', 'alsa', config.device);
    } else {
      args.push('-t', 'alsa', 'default');
    }

    // Output format: MP3 to stdout
    args.push('-t', 'mp3');

    // Channel count
    args.push('-c', String(config.channels || 1));

    // Sample rate
    args.push('-r', String(config.sampleRate || 22050));

    // Compression quality / bitrate for SOX MP3 output (-C setting)
    args.push('-C', String(config.mp3Bitrate || 64));

    // Output destination: stdout ( - )
    args.push('-');

    return args;
  }

  /**
   * Start mock streaming (periodically transmits valid MP3 silence frames)
   * @private
   */
  _startMockStreaming() {
    console.log('[AudioStreamer] Starting mock streaming');
    this._isStreaming = true;
    this._intentionalStop = false;

    // Generate valid MP3 silence frame
    this._mockSilenceFrame = this._generateValidMp3SilenceFrame();

    // Transmit frames at ~26ms intervals (~26ms per MP3 frame @22050Hz)
    const frameIntervalMs = 26;
    this._mockTimer = setInterval(() => {
      if ((this._clients.size > 0 || this._isRecording) && this._mockSilenceFrame) {
        this._broadcastChunk(this._mockSilenceFrame);
      }
    }, frameIntervalMs);

    this.emit('streamStart');
  }

  /**
   * Generate a valid MP3 silence frame that browsers can decode and play.
   * MPEG2 Layer3 64kbps 22050Hz Mono frame.
   * Frame size = 72 * 64000 / 22050 = 208.98... approx 209 bytes
   * @returns {Buffer} Valid MP3 frame buffer
   * @private
   */
  _generateValidMp3SilenceFrame() {
    // MPEG2 Layer3 header (4 bytes):
    // Byte 0: 0xFF (sync)
    // Byte 1: 0xF3 (sync + MPEG2, Layer3, no CRC protection)
    // Byte 2: 0x68 (64kbps for MPEG2 Layer3, 22050Hz, padding=0)
    // Byte 3: 0xC0 (mono, no mode extension, no copyright, original, no emphasis)
    const frameSize = 209;
    const frame = Buffer.alloc(frameSize, 0);

    // Write header
    frame[0] = 0xFF;
    frame[1] = 0xF3;
    frame[2] = 0x68;
    frame[3] = 0xC0;

    // Side information (MPEG2 Layer3 mono = 9 bytes)
    // main_data_begin = 0 (first 2 bits), remaining bits zero for silence
    // Bytes 4-12 remain all 0x00 (silent side information)

    return frame;
  }

  /**
   * Broadcast MP3 data chunk to all connected clients and recording pipe
   * @param {Buffer} chunk - MP3 data chunk
   * @private
   */
  _broadcastChunk(chunk) {
    // Distribute to streaming clients
    for (const client of this._clients) {
      try {
        if (!client.destroyed) {
          client.write(chunk);
        }
      } catch {
        // Erroneous clients are cleaned up in error event handler
      }
    }

    // Write to recording pipe
    if (this._isRecording && this._recordingStream && !this._recordingStream.destroyed) {
      try {
        this._recordingStream.write(chunk);
      } catch {
        // Write error handled in recordingStream error event listener
      }
    }
  }

  /**
   * Stop streaming (awaits SOX process shutdown via Promise)
   * @returns {Promise<void>} Promise resolving upon SOX exit
   * @private
   */
  _stopStreaming() {
    if (!this._isStreaming) {
      return Promise.resolve();
    }

    console.log('[AudioStreamer] Stopping streaming');
    this._intentionalStop = true;

    // Stop mock timer
    if (this._mockTimer) {
      clearInterval(this._mockTimer);
      this._mockTimer = null;
      this._isStreaming = false;
      this.emit('streamStop');
      return Promise.resolve();
    }

    // Stop SOX process (await completion via Promise)
    if (this._soxProcess) {
      this._stopPromise = new Promise((resolve) => {
        const proc = this._soxProcess;

        // Timeout: forcibly kill if process does not exit within 5 seconds
        const timeout = setTimeout(() => {
          console.warn('[AudioStreamer] SOX process shutdown timed out. Forcing SIGKILL.');
          try {
            proc.kill('SIGKILL');
          } catch {
            // Ignore error
          }
          this._isStreaming = false;
          this._soxProcess = null;
          this.emit('streamStop');
          resolve();
        }, 5000);

        // Detect clean exit via close event
        proc.once('close', () => {
          clearTimeout(timeout);
          this._isStreaming = false;
          this._soxProcess = null;
          this.emit('streamStop');
          resolve();
        });

        try {
          proc.kill('SIGINT');
        } catch (err) {
          console.error(`[AudioStreamer] SOX termination error:`, err.message);
          clearTimeout(timeout);
          this._isStreaming = false;
          this._soxProcess = null;
          this.emit('streamStop');
          resolve();
        }
      });

      return this._stopPromise;
    }

    this._isStreaming = false;
    this.emit('streamStop');
    return Promise.resolve();
  }

  /**
   * Close all client connections
   * @private
   */
  _closeAllClients() {
    for (const client of this._clients) {
      try {
        client.end();
      } catch {
        // Ignore error
      }
    }
    this._clients.clear();
  }

  /**
   * Release resources
   */
  async destroy() {
    this.stopRecordingPipe();
    await this._stopStreaming();
    this._closeAllClients();
    this.removeAllListeners();
  }
}

module.exports = AudioStreamer;
