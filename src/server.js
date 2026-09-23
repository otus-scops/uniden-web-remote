/**
 * @fileoverview Main Application Server
 * @description Boots Express HTTP server + WebSocket server,
 * integrating scanner serial control, recording, and REST API modules
 */

const http = require('http');
const express = require('express');
const path = require('path');

const config = require('./config/defaultConfig');
const SerialController = require('./scanner/serialController');
const ScannerState = require('./scanner/scannerState');
const AudioRecorder = require('./audio/audioRecorder');
const AudioStreamer = require('./audio/audioStreamer');
const createRoutes = require('./api/routes');
const WsHandler = require('./api/wsHandler');
const AudioWsHandler = require('./api/audioWsHandler');
const { parseMdlResponse, parseVerResponse } = require('./scanner/protocolParser');

/**
 * Main application server class
 * Manages full lifecycle of scanner connection, audio recording, and web services
 */
class AppServer {
  constructor() {
    /** @type {boolean} Mock mode flag */
    this._mockMode = config.mock.enabled;

    /** @type {express.Application} */
    this._app = express();

    /** @type {http.Server} */
    this._server = http.createServer(this._app);

    /** @type {SerialController} */
    this._serialController = new SerialController(config.serial, this._mockMode);

    /** @type {ScannerState} */
    this._scannerState = new ScannerState(config.scanner);

    /** @type {import('./scanner/programmingController')} */
    const ProgrammingController = require('./scanner/programmingController');
    this._programmingController = new ProgrammingController(this._serialController);

    /** @type {AudioStreamer} */
    this._audioStreamer = new AudioStreamer(config.audio, this._mockMode);

    /** @type {AudioRecorder} */
    this._audioRecorder = new AudioRecorder(config.audio, config.fileNaming, this._audioStreamer, this._mockMode);

    /** @type {WsHandler|null} */
    this._wsHandler = null;

    /** @type {AudioWsHandler|null} */
    this._audioWsHandler = null;
  }

  /**
   * Start the server and scanner connection
   */
  async start() {
    console.log('='.repeat(60));
    console.log('  BCT15X Remote Scanner & Automated Recording System');
    console.log('='.repeat(60));
    console.log(`  Mode: ${this._mockMode ? 'Mock (Simulation)' : 'Physical Hardware'}`);
    console.log(`  Serial Port: ${config.serial.path} @ ${config.serial.baudRate}bps`);
    console.log(`  Audio Format: ${config.audio.format}`);
    console.log(`  Audio Device: ${config.audio.device}`);
    console.log(`  Filename Template: ${config.fileNaming.template}`);
    console.log('='.repeat(60));

    // Configure Express middleware and routes
    this._setupExpress();

    // Setup WebSocket handlers
    this._wsHandler = new WsHandler({
      noServer: true,
      scannerState: this._scannerState,
      serialController: this._serialController,
      audioRecorder: this._audioRecorder,
      authConfig: config.auth,
    });

    this._audioWsHandler = new AudioWsHandler({
      audioStreamer: this._audioStreamer,
      authConfig: config.auth,
    });

    // Handle HTTP upgrade requests for WebSockets
    this._server.on('upgrade', (request, socket, head) => {
      try {
        const host = request.headers.host || 'localhost';
        const urlObj = new URL(request.url, `http://${host}`);
        if (urlObj.pathname === '/ws') {
          this._wsHandler.handleUpgrade(request, socket, head);
        } else if (urlObj.pathname === '/ws/audio') {
          this._audioWsHandler.handleUpgrade(request, socket, head);
        } else {
          socket.destroy();
        }
      } catch (err) {
        console.error('[Server] WebSocket upgrade error:', err.message);
        socket.destroy();
      }
    });

    // Wire internal events between subsystems
    this._setupEventBindings();

    // Connect to scanner hardware
    await this._connectScanner();

    // Start HTTP server
    return new Promise((resolve) => {
      this._server.listen(config.server.port, config.server.host, () => {
        console.log(`\n  🌐 Web UI: http://localhost:${config.server.port}`);
        console.log(`  📡 WebSocket (Control): ws://localhost:${config.server.port}/ws`);
        console.log(`  🔊 WebSocket (Live Audio): ws://localhost:${config.server.port}/ws/audio`);
        console.log(`  📂 Recordings Directory: ${config.audio.recordingsDir}`);
        if (config.gdrive.enabled) {
          console.log(`  ☁️  Google Drive Sync: Enabled (${config.gdrive.remotePath})`);
        }
        console.log('');
        resolve();
      });
    });
  }

  /**
   * Configure Express middleware and API routes
   * @private
   */
  _setupExpress() {
    // Body parsers
    this._app.use(express.json());

    // Service Worker route with explicit headers
    this._app.get('/sw.js', (req, res) => {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(__dirname, '../public/sw.js'));
    });

    // Serve static client assets
    this._app.use(express.static(path.join(__dirname, '../public')));

    // REST API routes
    const createAuthRoutes = require('./api/authRoutes');
    this._app.use('/api/auth', createAuthRoutes({ authConfig: config.auth }));

    const apiRoutes = createRoutes({
      serialController: this._serialController,
      scannerState: this._scannerState,
      audioRecorder: this._audioRecorder,
      audioStreamer: this._audioStreamer,
      config,
    });
    this._app.use('/api', apiRoutes);

    const createMemoryRoutes = require('./api/memoryRoutes');
    const memoryRoutes = createMemoryRoutes({
      programmingController: this._programmingController,
      authConfig: config.auth,
    });
    this._app.use('/api/memory', memoryRoutes);

    // SPA fallback
    this._app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
  }

  /**
   * Bind event listeners across subsystems
   * @private
   */
  _setupEventBindings() {
    // Serial Controller -> Scanner State
    this._serialController.on('glgUpdate', (glgData) => {
      this._scannerState.onGlgUpdate(glgData);
    });

    this._serialController.on('pwrUpdate', (pwrData) => {
      if (pwrData) {
        this._scannerState.onRssiUpdate(pwrData.rssi);
      }
    });

    this._serialController.on('connected', () => {
      this._scannerState.setConnected(true);
    });

    this._serialController.on('disconnected', () => {
      this._scannerState.setConnected(false);
      // Auto reconnect
      console.log(`[Server] Attempting reconnect in ${config.scanner.reconnectIntervalMs}ms...`);
      setTimeout(() => this._connectScanner(), config.scanner.reconnectIntervalMs);
    });

    // Scanner State -> Audio Recording
    this._scannerState.on('receptionStart', (data) => {
      if (this._scannerState.autoRecordEnabled && config.audio.autoRecord) {
        this._audioRecorder.startRecording(data.reception, data.startTime);
        this._scannerState.setRecording(true);
      }
    });

    this._scannerState.on('receptionEnd', () => {
      if (this._audioRecorder.isRecording()) {
        this._audioRecorder.stopRecording();
        this._scannerState.setRecording(false);
      }
    });

    // Audio recording event logs
    this._audioRecorder.on('recordingStart', (data) => {
      console.log(`[Server] 🔴 Recording started: ${data.filename}`);
    });

    this._audioRecorder.on('recordingStop', (data) => {
      console.log(`[Server] ⏹️  Recording stopped: ${data.filename} (${data.durationSec}s)`);
    });

    this._audioRecorder.on('recordingError', (data) => {
      console.error(`[Server] ❌ Recording error: ${data.error}`);
    });
  }

  /**
   * Connect to scanner hardware via serial
   * @private
   */
  async _connectScanner() {
    try {
      await this._serialController.connect();

      // Query model identifier
      try {
        const mdlResponse = await this._serialController.getModel();
        const mdl = parseMdlResponse(mdlResponse);
        if (mdl) {
          this._scannerState.setModel(mdl.model);
          console.log(`[Server] Model: ${mdl.model}`);
        }
      } catch {
        console.warn('[Server] Failed to query scanner model');
      }

      // Query firmware version
      try {
        const verResponse = await this._serialController.getVersion();
        const ver = parseVerResponse(verResponse);
        if (ver) {
          this._scannerState.setFirmwareVersion(ver.version);
          console.log(`[Server] Firmware: ${ver.version}`);
        }
      } catch {
        console.warn('[Server] Failed to query firmware version');
      }

      // Start periodic status polling
      this._serialController.startPolling(
        config.scanner.pollIntervalMs,
        config.scanner.statusIntervalMs
      );

      console.log('[Server] ✅ Scanner connected, polling started');
    } catch (err) {
      console.error(`[Server] Scanner connection error: ${err.message}`);
      if (!this._mockMode) {
        console.log(`[Server] Attempting reconnect in ${config.scanner.reconnectIntervalMs}ms...`);
        setTimeout(() => this._connectScanner(), config.scanner.reconnectIntervalMs);
      }
    }
  }

  /**
   * Stop server and clean up resources
   */
  async stop() {
    console.log('[Server] Shutting down...');

    this._serialController.stopPolling();

    if (this._audioRecorder.isRecording()) {
      this._audioRecorder.stopRecording();
    }

    await this._serialController.disconnect();

    if (this._wsHandler) {
      this._wsHandler.destroy();
    }

    if (this._audioWsHandler) {
      this._audioWsHandler.destroy();
    }

    this._scannerState.destroy();
    this._audioRecorder.destroy();
    this._audioStreamer.destroy();
    this._serialController.destroy();

    return new Promise((resolve) => {
      this._server.close(resolve);
    });
  }
}

// Main entrypoint execution
const server = new AppServer();

server.start().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});

module.exports = AppServer;
