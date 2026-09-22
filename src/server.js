/**
 * @fileoverview メインサーバー
 * @description Express HTTPサーバー + WebSocketサーバーを起動し、
 * スキャナー制御・録音・APIの各モジュールを統合する
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
const { parseMdlResponse, parseVerResponse } = require('./scanner/protocolParser');

/**
 * メインサーバークラス
 * アプリケーション全体のライフサイクルを管理する
 */
class AppServer {
  constructor() {
    /** @type {boolean} モックモード */
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
  }

  /**
   * サーバーを起動する
   */
  async start() {
    console.log('='.repeat(60));
    console.log('  BCT15X リモートスキャナー＆自動録音システム');
    console.log('='.repeat(60));
    console.log(`  モード: ${this._mockMode ? 'モック（テスト）' : '実機接続'}`);
    console.log(`  シリアルポート: ${config.serial.path} @ ${config.serial.baudRate}bps`);
    console.log(`  録音フォーマット: ${config.audio.format}`);
    console.log(`  録音デバイス: ${config.audio.device}`);
    console.log(`  ファイル名テンプレート: ${config.fileNaming.template}`);
    console.log('='.repeat(60));

    // Express設定
    this._setupExpress();

    // WebSocket設定
    this._wsHandler = new WsHandler({
      server: this._server,
      scannerState: this._scannerState,
      serialController: this._serialController,
      audioRecorder: this._audioRecorder,
    });

    // イベントバインディング
    this._setupEventBindings();

    // シリアル接続
    await this._connectScanner();

    // HTTPサーバー起動
    return new Promise((resolve) => {
      this._server.listen(config.server.port, config.server.host, () => {
        console.log(`\n  🌐 Web UI: http://localhost:${config.server.port}`);
        console.log(`  📡 WebSocket: ws://localhost:${config.server.port}/ws`);
        console.log(`  📂 録音保存先: ${config.audio.recordingsDir}`);
        if (config.gdrive.enabled) {
          console.log(`  ☁️  Google Drive同期: 有効 (${config.gdrive.remotePath})`);
        }
        console.log('');
        resolve();
      });
    });
  }

  /**
   * Expressミドルウェアとルートを設定する
   * @private
   */
  _setupExpress() {
    // JSONパーサー
    this._app.use(express.json());

    // 静的ファイル配信
    this._app.use(express.static(path.join(__dirname, '../public')));

    // APIルート
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
    });
    this._app.use('/api/memory', memoryRoutes);

    // SPA フォールバック
    this._app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
  }

  /**
   * モジュール間のイベントバインディングを設定する
   * @private
   */
  _setupEventBindings() {
    // シリアルコントローラー → スキャナー状態
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
      // 自動再接続
      console.log(`[Server] ${config.scanner.reconnectIntervalMs}ms後に再接続を試行します...`);
      setTimeout(() => this._connectScanner(), config.scanner.reconnectIntervalMs);
    });

    // スキャナー状態 → 録音管理
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

    // 録音イベントログ
    this._audioRecorder.on('recordingStart', (data) => {
      console.log(`[Server] 🔴 録音開始: ${data.filename}`);
    });

    this._audioRecorder.on('recordingStop', (data) => {
      console.log(`[Server] ⏹️  録音停止: ${data.filename} (${data.durationSec}秒)`);
    });

    this._audioRecorder.on('recordingError', (data) => {
      console.error(`[Server] ❌ 録音エラー: ${data.error}`);
    });
  }

  /**
   * スキャナーに接続する
   * @private
   */
  async _connectScanner() {
    try {
      await this._serialController.connect();

      // モデル情報取得
      try {
        const mdlResponse = await this._serialController.getModel();
        const mdl = parseMdlResponse(mdlResponse);
        if (mdl) {
          this._scannerState.setModel(mdl.model);
          console.log(`[Server] モデル: ${mdl.model}`);
        }
      } catch {
        console.warn('[Server] モデル情報の取得に失敗しました');
      }

      // バージョン情報取得
      try {
        const verResponse = await this._serialController.getVersion();
        const ver = parseVerResponse(verResponse);
        if (ver) {
          this._scannerState.setFirmwareVersion(ver.version);
          console.log(`[Server] ファームウェア: ${ver.version}`);
        }
      } catch {
        console.warn('[Server] バージョン情報の取得に失敗しました');
      }

      // ポーリング開始
      this._serialController.startPolling(
        config.scanner.pollIntervalMs,
        config.scanner.statusIntervalMs
      );

      console.log('[Server] ✅ スキャナー接続完了、ポーリング開始');
    } catch (err) {
      console.error(`[Server] スキャナー接続失敗: ${err.message}`);
      if (!this._mockMode) {
        console.log(`[Server] ${config.scanner.reconnectIntervalMs}ms後に再接続を試行します...`);
        setTimeout(() => this._connectScanner(), config.scanner.reconnectIntervalMs);
      }
    }
  }

  /**
   * サーバーを停止する
   */
  async stop() {
    console.log('[Server] シャットダウン中...');

    this._serialController.stopPolling();

    if (this._audioRecorder.isRecording()) {
      this._audioRecorder.stopRecording();
    }

    await this._serialController.disconnect();

    if (this._wsHandler) {
      this._wsHandler.destroy();
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

// メイン実行
const server = new AppServer();

server.start().catch((err) => {
  console.error('起動エラー:', err);
  process.exit(1);
});

// グレースフルシャットダウン
process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});

module.exports = AppServer;
