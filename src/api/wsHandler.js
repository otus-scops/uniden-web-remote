/**
 * @fileoverview WebSocket ハンドラー
 * @description WebSocket接続管理とリアルタイムステータス配信を行う
 */

const WebSocket = require('ws');

/**
 * WebSocketハンドラークラス
 * クライアントへのリアルタイムステータス配信を管理する
 */
class WsHandler {
  /**
   * @param {Object} deps - 依存オブジェクト
   * @param {import('http').Server} deps.server - HTTPサーバー
   * @param {import('../scanner/scannerState')} deps.scannerState - スキャナー状態
   * @param {import('../scanner/serialController')} deps.serialController - シリアルコントローラー
   * @param {import('../audio/audioRecorder')} deps.audioRecorder - 録音管理
   */
  constructor({ server, scannerState, serialController, audioRecorder }) {
    /** @type {WebSocket.Server} WebSocketサーバー */
    this._wss = new WebSocket.Server({ server, path: '/ws' });

    /** @type {import('../scanner/scannerState')} */
    this._scannerState = scannerState;

    /** @type {import('../scanner/serialController')} */
    this._serialController = serialController;

    /** @type {import('../audio/audioRecorder')} */
    this._audioRecorder = audioRecorder;

    /** @type {Set<WebSocket>} 接続中クライアント */
    this._clients = new Set();

    this._setupWebSocketServer();
    this._setupEventForwarding();
  }

  /**
   * WebSocketサーバーのイベントハンドラーを設定する
   * @private
   */
  _setupWebSocketServer() {
    this._wss.on('connection', (ws) => {
      console.log('[WsHandler] クライアント接続');
      this._clients.add(ws);

      // 接続時に現在のステータスを送信
      this._sendToClient(ws, {
        type: 'status',
        data: this._scannerState.getStatus(),
      });

      // クライアントからのメッセージ処理
      ws.on('message', (message) => {
        this._onClientMessage(ws, message);
      });

      // 切断処理
      ws.on('close', () => {
        console.log('[WsHandler] クライアント切断');
        this._clients.delete(ws);
      });

      // エラー処理
      ws.on('error', (err) => {
        console.error('[WsHandler] WebSocketエラー:', err.message);
        this._clients.delete(ws);
      });
    });
  }

  /**
   * スキャナー/録音イベントをWebSocketクライアントに転送する
   * @private
   */
  _setupEventForwarding() {
    // ステータス更新
    this._scannerState.on('statusUpdate', (status) => {
      this._broadcast({
        type: 'status',
        data: status,
      });
    });

    // 受信開始
    this._scannerState.on('receptionStart', (data) => {
      this._broadcast({
        type: 'receptionStart',
        data,
      });
    });

    // 受信終了
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

    // 録音開始
    this._audioRecorder.on('recordingStart', (data) => {
      this._broadcast({
        type: 'recordingStart',
        data: {
          filename: data.filename,
          startTime: data.startTime ? data.startTime.toISOString() : null,
        },
      });
    });

    // 録音停止
    this._audioRecorder.on('recordingStop', (data) => {
      this._broadcast({
        type: 'recordingStop',
        data: {
          filename: data.filename,
          durationSec: data.durationSec,
        },
      });
    });

    // 録音エラー
    this._audioRecorder.on('recordingError', (data) => {
      this._broadcast({
        type: 'recordingError',
        data,
      });
    });

    // シリアルデータ（デバッグ用）
    this._serialController.on('data', (rawData) => {
      this._broadcast({
        type: 'serialData',
        data: { raw: rawData },
      });
    });
  }

  /**
   * クライアントからのメッセージを処理する
   * @param {WebSocket} ws - 送信元WebSocket
   * @param {string} message - メッセージ文字列
   * @private
   */
  async _onClientMessage(ws, message) {
    try {
      const msg = JSON.parse(message.toString());

      switch (msg.type) {
        case 'command':
          // シリアルコマンドの送信
          if (msg.command) {
            const response = await this._serialController.sendCommand(msg.command);
            this._sendToClient(ws, {
              type: 'commandResponse',
              data: { command: msg.command, response },
            });
          }
          break;

        case 'key':
          // キープレス
          if (msg.key) {
            const response = await this._serialController.pressKey(msg.key, msg.action || 'P');
            this._sendToClient(ws, {
              type: 'commandResponse',
              data: { key: msg.key, response },
            });
          }
          break;

        case 'getStatus':
          // ステータス要求
          this._sendToClient(ws, {
            type: 'status',
            data: this._scannerState.getStatus(),
          });
          break;

        case 'getLog':
          // ログ要求
          this._sendToClient(ws, {
            type: 'log',
            data: this._scannerState.getLog(msg.limit || 100, msg.offset || 0),
          });
          break;

        case 'toggleAutoRecord':
          // 自動録音切り替え
          this._scannerState.autoRecordEnabled = !this._scannerState.autoRecordEnabled;
          this._broadcast({
            type: 'status',
            data: this._scannerState.getStatus(),
          });
          break;

        default:
          console.log(`[WsHandler] 不明なメッセージタイプ: ${msg.type}`);
      }
    } catch (err) {
      console.error('[WsHandler] メッセージ処理エラー:', err.message);
      this._sendToClient(ws, {
        type: 'error',
        data: { message: err.message },
      });
    }
  }

  /**
   * 全クライアントにメッセージをブロードキャストする
   * @param {Object} message - 送信するメッセージオブジェクト
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
   * 特定のクライアントにメッセージを送信する
   * @param {WebSocket} ws - 送信先WebSocket
   * @param {Object} message - メッセージオブジェクト
   * @private
   */
  _sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * 接続中のクライアント数を取得する
   * @returns {number}
   */
  getClientCount() {
    return this._clients.size;
  }

  /**
   * リソースを解放する
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
