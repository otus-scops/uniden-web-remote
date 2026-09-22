/**
 * @fileoverview WebSocket Handler
 * @description Manages WebSocket connections and real-time scanner status broadcasting
 */

const WebSocket = require('ws');

/**
 * WebSocket Handler Class
 * Manages real-time client subscriptions and state updates
 */
class WsHandler {
  /**
   * @param {Object} deps - Dependencies
   * @param {import('http').Server} deps.server - HTTP server instance
   * @param {import('../scanner/scannerState')} deps.scannerState - Scanner state manager
   * @param {import('../scanner/serialController')} deps.serialController - Serial controller
   * @param {import('../audio/audioRecorder')} deps.audioRecorder - Audio recorder
   */
  constructor({ server, scannerState, serialController, audioRecorder }) {
    /** @type {WebSocket.Server} WebSocket server instance */
    this._wss = new WebSocket.Server({ server, path: '/ws' });

    /** @type {import('../scanner/scannerState')} */
    this._scannerState = scannerState;

    /** @type {import('../scanner/serialController')} */
    this._serialController = serialController;

    /** @type {import('../audio/audioRecorder')} */
    this._audioRecorder = audioRecorder;

    /** @type {Set<WebSocket>} Connected client sockets */
    this._clients = new Set();

    this._setupWebSocketServer();
    this._setupEventForwarding();
  }

  /**
   * Configure WebSocket server connection handlers
   * @private
   */
  _setupWebSocketServer() {
    this._wss.on('connection', (ws) => {
      console.log('[WsHandler] Client connected');
      this._clients.add(ws);

      // Send initial status on connection
      this._sendToClient(ws, {
        type: 'status',
        data: this._scannerState.getStatus(),
      });

      // Handle client messages
      ws.on('message', (message) => {
        this._onClientMessage(ws, message);
      });

      // Handle disconnect
      ws.on('close', () => {
        console.log('[WsHandler] Client disconnected');
        this._clients.delete(ws);
      });

      // Handle socket errors
      ws.on('error', (err) => {
        console.error('[WsHandler] WebSocket error:', err.message);
        this._clients.delete(ws);
      });
    });
  }

  /**
   * Forward scanner and audio recording events to WebSocket clients
   * @private
   */
  _setupEventForwarding() {
    // Scanner status update
    this._scannerState.on('statusUpdate', (status) => {
      this._broadcast({
        type: 'status',
        data: status,
      });
    });

    // Reception start
    this._scannerState.on('receptionStart', (data) => {
      this._broadcast({
        type: 'receptionStart',
        data,
      });
    });

    // Reception end
    this._scannerState.on('receptionEnd', (data) => {
      this._broadcast({
        type: 'receptionEnd',
        data: {
          ...data,
          startTime: data.startTime ? data.startTime.toISOString() : null,
          endTime: data.endTime ? data.endTime.toISOString() : null,
        },
      });
    });

    // Recording start
    this._audioRecorder.on('recordingStart', (data) => {
      this._broadcast({
        type: 'recordingStart',
        data: {
          filename: data.filename,
          startTime: data.startTime ? data.startTime.toISOString() : null,
        },
      });
    });

    // Recording stop
    this._audioRecorder.on('recordingStop', (data) => {
      this._broadcast({
        type: 'recordingStop',
        data: {
          filename: data.filename,
          durationSec: data.durationSec,
        },
      });
    });

    // Recording error
    this._audioRecorder.on('recordingError', (data) => {
      this._broadcast({
        type: 'recordingError',
        data,
      });
    });

    // Raw serial debug data
    this._serialController.on('data', (rawData) => {
      this._broadcast({
        type: 'serialData',
        data: { raw: rawData },
      });
    });
  }

  /**
   * Process message received from client
   * @param {WebSocket} ws - Source WebSocket
   * @param {string} message - Raw message payload
   * @private
   */
  async _onClientMessage(ws, message) {
    try {
      const msg = JSON.parse(message.toString());

      switch (msg.type) {
        case 'command':
          // Send raw serial command
          if (msg.command) {
            const response = await this._serialController.sendCommand(msg.command);
            this._sendToClient(ws, {
              type: 'commandResponse',
              data: { command: msg.command, response },
            });
          }
          break;

        case 'key':
          // Simulate front panel keypad press
          if (msg.key) {
            const response = await this._serialController.pressKey(msg.key, msg.action || 'P');
            this._sendToClient(ws, {
              type: 'commandResponse',
              data: { key: msg.key, response },
            });
          }
          break;

        case 'getStatus':
          // Request status snapshot
          this._sendToClient(ws, {
            type: 'status',
            data: this._scannerState.getStatus(),
          });
          break;

        case 'getLog':
          // Request activity log history
          this._sendToClient(ws, {
            type: 'log',
            data: this._scannerState.getLog(msg.limit || 100, msg.offset || 0),
          });
          break;

        case 'toggleAutoRecord':
          // Toggle auto-recording setting
          this._scannerState.autoRecordEnabled = !this._scannerState.autoRecordEnabled;
          this._broadcast({
            type: 'status',
            data: this._scannerState.getStatus(),
          });
          break;

        default:
          console.log(`[WsHandler] Unknown message type: ${msg.type}`);
      }
    } catch (err) {
      console.error('[WsHandler] Message processing error:', err.message);
      this._sendToClient(ws, {
        type: 'error',
        data: { message: err.message },
      });
    }
  }

  /**
   * Broadcast message to all connected clients
   * @param {Object} message - Message object to serialize
   * @private
   */
  _broadcast(message) {
    const data = JSON.stringify(message);

    for (const client of this._clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Send message to a specific client
   * @param {WebSocket} ws - Target WebSocket
   * @param {Object} message - Message object
   * @private
   */
  _sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Get count of currently connected clients
   * @returns {number}
   */
  getClientCount() {
    return this._clients.size;
  }

  /**
   * Clean up and close all client connections
   */
  destroy() {
    for (const client of this._clients) {
      client.close();
    }
    this._clients.clear();
    this._wss.close();
  }
}

module.exports = WsHandler;
