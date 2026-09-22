/**
 * @fileoverview REST API Route Definitions
 * @description Endpoints for scanner control, recording management, streaming, and settings
 */

const express = require('express');
const path = require('path');
const { generatePreview } = require('../audio/fileNamer');

/**
 * Create Express router for API routes
 * @param {Object} deps - Dependencies
 * @param {import('../scanner/serialController')} deps.serialController - Serial controller
 * @param {import('../scanner/scannerState')} deps.scannerState - Scanner state
 * @param {import('../audio/audioRecorder')} deps.audioRecorder - Audio recorder
 * @param {Object} deps.config - System config
 * @returns {express.Router} Express router
 */
function createRoutes({ serialController, scannerState, audioRecorder, audioStreamer, config }) {
  const router = express.Router();

  // ------ Scanner Status ------

  /**
   * GET /api/status - Get current scanner status snapshot
   */
  router.get('/status', (req, res) => {
    res.json(scannerState.getStatus());
  });

  /**
   * GET /api/info - Get scanner hardware information (model, firmware)
   */
  router.get('/info', async (req, res) => {
    try {
      res.json({
        model: scannerState.model,
        firmwareVersion: scannerState.firmwareVersion,
        isConnected: scannerState.isConnected,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ------ Scanner Commands ------

  /**
   * POST /api/scanner/command - Send raw serial command
   * @body {string} command - Command string
   */
  router.post('/scanner/command', async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ error: 'Command parameter is required' });
      }

      const response = await serialController.sendCommand(command);
      res.json({ command, response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/scanner/key - Simulate front panel keypad press
   * @body {string} key - Key name identifier
   * @body {string} [action='P'] - Key action ('P'ress, 'H'old, 'R'elease)
   */
  router.post('/scanner/key', async (req, res) => {
    try {
      const { key, action = 'P' } = req.body;
      if (!key) {
        return res.status(400).json({ error: 'Key parameter is required' });
      }

      const response = await serialController.pressKey(key, action);
      res.json({ key, action, response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/scanner/scan - Start scanning
   */
  router.post('/scanner/scan', async (req, res) => {
    try {
      const response = await serialController.startScan();
      res.json({ action: 'scan', response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/scanner/hold - Hold current frequency/channel
   */
  router.post('/scanner/hold', async (req, res) => {
    try {
      const response = await serialController.hold();
      res.json({ action: 'hold', response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/scanner/vol - Set scanner volume
   * @body {number} level - Volume level (0-15)
   */
  router.post('/scanner/vol', async (req, res) => {
    try {
      const { level } = req.body;
      if (level === undefined || level < 0 || level > 15) {
        return res.status(400).json({ error: 'Valid level parameter (0-15) is required' });
      }
      const response = await serialController.setVolume(level);
      res.json({ action: 'vol', level, response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/scanner/sql - Set scanner squelch
   * @body {number} level - Squelch level (0-15)
   */
  router.post('/scanner/sql', async (req, res) => {
    try {
      const { level } = req.body;
      if (level === undefined || level < 0 || level > 15) {
        return res.status(400).json({ error: 'Valid level parameter (0-15) is required' });
      }
      const response = await serialController.setSquelch(level);
      res.json({ action: 'sql', level, response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ------ Live Audio Streaming ------

  /**
   * GET /api/audio/stream - Live MP3 audio stream
   * Delivers continuous MP3 audio chunk stream.
   * Cleans up client resources on disconnect.
   */
  router.get('/audio/stream', (req, res) => {
    // Set streaming HTTP response headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Connection', 'keep-alive');
    // Enable CORS for cross-origin streaming
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Register client listener stream
    const clientStream = audioStreamer.addClient();

    // Pipe live audio stream directly into HTTP response
    clientStream.pipe(res);

    // Clean up resources when client disconnects
    req.on('close', () => {
      clientStream.unpipe(res);
      clientStream.destroy();
    });

    req.on('error', () => {
      clientStream.unpipe(res);
      clientStream.destroy();
    });
  });

  /**
   * GET /api/audio/status - Get streaming subsystem status
   */
  router.get('/audio/status', (req, res) => {
    res.json({
      isStreaming: audioStreamer.isStreaming(),
      clientCount: audioStreamer.getClientCount(),
    });
  });

  // ------ Recording Management ------

  /**
   * GET /api/recordings - Get recording file list with filtering
   * @query {string} [dateFrom] - Start date (ISO)
   * @query {string} [dateTo] - End date (ISO)
   * @query {string} [search] - Substring search on filename
   */
  router.get('/recordings', (req, res) => {
    const filters = {};

    if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom;
    if (req.query.dateTo) filters.dateTo = req.query.dateTo;
    if (req.query.search) filters.search = req.query.search;

    const recordings = audioRecorder.getRecordings(filters);
    res.json({
      recordings,
      total: recordings.length,
      isRecording: audioRecorder.isRecording(),
    });
  });

  /**
   * GET /api/recordings/* - Download or stream recording file
   * Supports subdirectory paths (e.g. /api/recordings/2026-08-08/Dispatch/file.mp3)
   */
  router.get('/recordings/*', (req, res) => {
    // Extract relative file path from wildcard capture
    const relativePath = req.params[0];
    if (!relativePath) {
      return res.status(400).json({ error: 'ファイルパスが必要です' });
    }

    const filePath = audioRecorder.getRecordingPath(relativePath);
    if (!filePath) {
      return res.status(404).json({ error: 'ファイルが見つかりません' });
    }

    // Set Content-Type header based on file extension
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.sendFile(filePath);
  });

  /**
   * DELETE /api/recordings/* - Delete recording file
   * Supports subdirectory paths
   */
  router.delete('/recordings/*', (req, res) => {
    const relativePath = req.params[0];
    if (!relativePath) {
      return res.status(400).json({ error: 'ファイルパスが必要です' });
    }

    const deleted = audioRecorder.deleteRecording(relativePath);
    if (deleted) {
      res.json({ deleted: true, filename: relativePath });
    } else {
      res.status(404).json({ error: 'ファイルが見つかりません' });
    }
  });

  /**
   * POST /api/recordings/toggle - Toggle auto-recording mode
   */
  router.post('/recordings/toggle', (req, res) => {
    scannerState.autoRecordEnabled = !scannerState.autoRecordEnabled;
    res.json({ autoRecordEnabled: scannerState.autoRecordEnabled });
  });

  // ------ Reception Log ------

  /**
   * GET /api/log - Get reception history log with filter options
   * @query {number} [limit=100] - Entry limit
   * @query {number} [offset=0] - Offset index
   * @query {string} [dateFrom] - Start date (ISO)
   * @query {string} [dateTo] - End date (ISO)
   * @query {string} [freq] - Frequency/TGID filter
   * @query {string} [system] - System name filter
   * @query {string} [channel] - Channel name filter
   * @query {string} [modulation] - Modulation mode filter
   * @query {number} [minDuration] - Minimum duration in seconds
   */
  router.get('/log', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    // Assemble filter query criteria
    const filters = {};
    if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom;
    if (req.query.dateTo) filters.dateTo = req.query.dateTo;
    if (req.query.freq) filters.freq = req.query.freq;
    if (req.query.system) filters.system = req.query.system;
    if (req.query.channel) filters.channel = req.query.channel;
    if (req.query.modulation) filters.modulation = req.query.modulation;
    if (req.query.minDuration) filters.minDuration = req.query.minDuration;

    res.json(scannerState.getLog(limit, offset, filters));
  });

  /**
   * DELETE /api/log - Clear reception history log
   */
  router.delete('/log', (req, res) => {
    scannerState.clearLog();
    res.json({ cleared: true });
  });

  // ------ Settings ------

  /**
   * GET /api/config - Get current system configuration
   */
  router.get('/config', (req, res) => {
    // Return safe configuration subset
    res.json({
      serial: {
        path: config.serial.path,
        baudRate: config.serial.baudRate,
      },
      audio: {
        device: config.audio.device,
        format: config.audio.format,
        sampleRate: config.audio.sampleRate,
        channels: config.audio.channels,
        autoRecord: config.audio.autoRecord,
      },
      fileNaming: {
        template: config.fileNaming.template,
      },
      scanner: {
        pollIntervalMs: config.scanner.pollIntervalMs,
        receptionTimeoutMs: config.scanner.receptionTimeoutMs,
      },
      gdrive: {
        enabled: config.gdrive.enabled,
        remotePath: config.gdrive.remotePath,
        syncIntervalSec: config.gdrive.syncIntervalSec,
      },
    });
  });

  /**
   * PUT /api/config - Update configuration
   */
  router.put('/config', (req, res) => {
    const updates = req.body;

    // Update filename template pattern
    if (updates.fileNaming && updates.fileNaming.template) {
      config.fileNaming.template = updates.fileNaming.template;
    }

    // Update auto-recording setting
    if (updates.audio && updates.audio.autoRecord !== undefined) {
      config.audio.autoRecord = updates.audio.autoRecord;
      scannerState.autoRecordEnabled = updates.audio.autoRecord;
    }

    // Update reception timeout threshold
    if (updates.scanner && updates.scanner.receptionTimeoutMs) {
      config.scanner.receptionTimeoutMs = updates.scanner.receptionTimeoutMs;
    }

    res.json({ updated: true, config: req.body });
  });

  /**
   * POST /api/config/template-preview - Generate filename template preview
   * @body {string} template - Template pattern string to evaluate
   */
  router.post('/config/template-preview', (req, res) => {
    const { template } = req.body;
    if (!template) {
      return res.status(400).json({ error: 'templateパラメータが必要です' });
    }

    const preview = generatePreview(template);
    res.json({ template, preview });
  });

  return router;
}

module.exports = createRoutes;


