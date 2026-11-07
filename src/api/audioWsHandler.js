/**
 * @fileoverview Audio WebSocket Handler
 * @description Manages WebSocket connections for ultra low-latency raw PCM audio streaming
 */

const WebSocket = require('ws');
const { verifyToken } = require('./authMiddleware');

/**
 * Audio WebSocket Handler Class
 * Distributes real-time PCM audio chunks to connected browser clients via WebSocket
 */
class AudioWsHandler {
  /**
   * @param {Object} deps - Dependencies
   * @param {import('../audio/audioStreamer')} deps.audioStreamer - Audio streamer instance
   * @param {Object} [deps.authConfig={}] - Authentication configuration
   */
  constructor({ audioStreamer, authConfig = {} }) {
    /** @type {WebSocket.Server} */
    this._wss = new WebSocket.Server({ noServer: true });

    /** @type {import('../audio/audioStreamer')} */
    this._audioStreamer = audioStreamer;

    /** @type {Object} */
    this._authConfig = authConfig;

    /** @type {Set<WebSocket>} Connected audio client sockets */
    this._clients = new Set();

    /** @type {((chunk: Buffer) => void)|null} */
    this._onAudioData = null;

    this._setupWebSocketServer();
    this._setupAudioForwarding();
  }

  /**
   * Handle HTTP upgrade request for audio WebSocket endpoint (/ws/audio)
   * @param {import('http').IncomingMessage} request
   * @param {import('net').Socket} socket
   * @param {Buffer} head
   */
  handleUpgrade(request, socket, head) {
    this._wss.handleUpgrade(request, socket, head, (ws) => {
      this._wss.emit('connection', ws, request);
    });
  }

  /**
   * Configure WebSocket connection listeners
   * @private
   */
  _setupWebSocketServer() {
    this._wss.on('connection', (ws, req) => {
      // If auth is enabled, verify token from query string (?token=...)
      if (this._authConfig && this._authConfig.enabled) {
        try {
          const host = req.headers.host || 'localhost';
          const urlObj = new URL(req.url, `http://${host}`);
          const token = urlObj.searchParams.get('token');
          const payload = verifyToken(token, this._authConfig.secret);
          if (!payload) {
            console.warn('[AudioWsHandler] Unauthorized audio connection attempt rejected');
            ws.close(4001, 'Unauthorized');
            return;
          }
        } catch {
          ws.close(4001, 'Unauthorized');
          return;
        }
      }

      console.log('[AudioWsHandler] Client connected for live audio');
      this._clients.add(ws);
      this._audioStreamer.addAudioListener(ws);

      ws.on('close', () => {
        console.log('[AudioWsHandler] Audio client disconnected');
        this._clients.delete(ws);
        this._audioStreamer.removeAudioListener(ws);
      });

      ws.on('error', (err) => {
        console.error('[AudioWsHandler] Audio WebSocket error:', err.message);
        this._clients.delete(ws);
        this._audioStreamer.removeAudioListener(ws);
      });
    });
  }

  /**
   * Forward PCM audio chunks from AudioStreamer to connected WebSocket clients
   * @private
   */
  _setupAudioForwarding() {
    this._onAudioData = (chunk) => {
      if (this._clients.size === 0) {
        return;
      }

      for (const client of this._clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(chunk, { binary: true });
          } catch (err) {
            console.error('[AudioWsHandler] Client send error:', err.message);
          }
        }
      }
    };

    this._audioStreamer.on('audioData', this._onAudioData);
  }

  /**
   * Get connected audio client count
   * @returns {number}
   */
  getClientCount() {
    return this._clients.size;
  }

  /**
   * Clean up resources and close all client connections
   */
  destroy() {
    if (this._onAudioData) {
      this._audioStreamer.removeListener('audioData', this._onAudioData);
      this._onAudioData = null;
    }

    for (const client of this._clients) {
      try {
        client.close();
      } catch {
        // Ignore error on shutdown
      }
    }
    this._clients.clear();
    this._wss.close();
  }
}

module.exports = AudioWsHandler;
