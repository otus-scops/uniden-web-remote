/**
 * @fileoverview REST API ルート定義
 * @description スキャナー制御、録音管理、設定変更用のREST APIエンドポイント
 */

const express = require('express');
const path = require('path');
const { generatePreview } = require('../audio/fileNamer');

/**
 * APIルートを生成する
 * @param {Object} deps - 依存オブジェクト
 * @param {import('../scanner/serialController')} deps.serialController - シリアルコントローラー
 * @param {import('../scanner/scannerState')} deps.scannerState - スキャナー状態
 * @param {import('../audio/audioRecorder')} deps.audioRecorder - 録音管理
 * @param {Object} deps.config - 設定
 * @returns {express.Router} Expressルーター
 */
function createRoutes({ serialController, scannerState, audioRecorder, audioStreamer, config }) {
  const router = express.Router();

  // ------ スキャナーステータス ------

  /**
   * GET /api/status - 現在のスキャナーステータスを取得
   */
  router.get('/status', (req, res) => {
    res.json(scannerState.getStatus());
  });

  /**
   * GET /api/info - スキャナー情報（モデル、バージョン）を取得
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

  // ------ スキャナーコマンド ------

  /**
   * POST /api/scanner/command - 任意のコマンドを送信
   * @body {string} command - コマンド文字列
   */
  router.post('/scanner/command', async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ error: 'commandパラメータが必要です' });
      }

      const response = await serialController.sendCommand(command);
      res.json({ command, response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/scanner/key - キープレスをシミュレート
   * @body {string} key - キー名
   * @body {string} [action='P'] - アクション（P/H/R）
   */
  router.post('/scanner/key', async (req, res) => {
    try {
      const { key, action = 'P' } = req.body;
      if (!key) {
        return res.status(400).json({ error: 'keyパラメータが必要です' });
      }

      const response = await serialController.pressKey(key, action);
      res.json({ key, action, response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/scanner/scan - スキャン開始
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
   * POST /api/scanner/hold - ホールド
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
   * POST /api/scanner/vol - 音量設定
   * @body {number} level - 音量レベル (0-15)
   */
  router.post('/scanner/vol', async (req, res) => {
    try {
      const { level } = req.body;
      if (level === undefined || level < 0 || level > 15) {
        return res.status(400).json({ error: '有効なlevelパラメータ(0-15)が必要です' });
      }
      const response = await serialController.setVolume(level);
      res.json({ action: 'vol', level, response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/scanner/sql - スケルチ設定
   * @body {number} level - スケルチレベル (0-15)
   */
  router.post('/scanner/sql', async (req, res) => {
    try {
      const { level } = req.body;
      if (level === undefined || level < 0 || level > 15) {
        return res.status(400).json({ error: '有効なlevelパラメータ(0-15)が必要です' });
      }
      const response = await serialController.setSquelch(level);
      res.json({ action: 'sql', level, response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ------ ライブ音声ストリーミング ------

  /**
   * GET /api/audio/stream - ライブ音声MP3ストリーム
   * 連続的なMP3データをchunked transferで配信する。
   * クライアント切断時にリソースをクリーンアップする。
   */
  router.get('/audio/stream', (req, res) => {
    // レスポンスヘッダー設定
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Connection', 'keep-alive');
    // CORS対応（別オリジンからのストリーミング再生を許可）
    res.setHeader('Access-Control-Allow-Origin', '*');

    // クライアントストリームを取得
    const clientStream = audioStreamer.addClient();

    // クライアントストリームからHTTPレスポンスにパイプ
    clientStream.pipe(res);

    // クライアント切断時のクリーンアップ
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
   * GET /api/audio/status - ストリーミング状態を取得
   */
  router.get('/audio/status', (req, res) => {
    res.json({
      isStreaming: audioStreamer.isStreaming(),
      clientCount: audioStreamer.getClientCount(),
    });
  });

  // ------ 録音管理 ------

  /**
   * GET /api/recordings - 録音ファイルリストを取得（フィルタリング対応）
   * @query {string} [dateFrom] - 開始日時（ISO形式）
   * @query {string} [dateTo] - 終了日時（ISO形式）
   * @query {string} [search] - ファイル名検索（部分一致）
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
   * GET /api/recordings/* - 録音ファイルをダウンロード/ストリーミング
   * サブディレクトリを含むパスに対応（例: /api/recordings/2026-08-08/Dispatch/file.mp3）
   */
  router.get('/recordings/*', (req, res) => {
    // ワイルドカード部分からファイルパスを取得
    const relativePath = req.params[0];
    if (!relativePath) {
      return res.status(400).json({ error: 'ファイルパスが必要です' });
    }

    const filePath = audioRecorder.getRecordingPath(relativePath);
    if (!filePath) {
      return res.status(404).json({ error: 'ファイルが見つかりません' });
    }

    // Content-Typeを設定
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
   * DELETE /api/recordings/* - 録音ファイルを削除
   * サブディレクトリを含むパスに対応
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
   * POST /api/recordings/toggle - 自動録音のON/OFF切り替え
   */
  router.post('/recordings/toggle', (req, res) => {
    scannerState.autoRecordEnabled = !scannerState.autoRecordEnabled;
    res.json({ autoRecordEnabled: scannerState.autoRecordEnabled });
  });

  // ------ 受信ログ ------

  /**
   * GET /api/log - 受信ログを取得（フィルタリング対応）
   * @query {number} [limit=100] - 取得件数
   * @query {number} [offset=0] - オフセット
   * @query {string} [dateFrom] - 開始日時（ISO形式）
   * @query {string} [dateTo] - 終了日時（ISO形式）
   * @query {string} [freq] - 周波数/TGID（部分一致）
   * @query {string} [system] - システム名（部分一致）
   * @query {string} [channel] - チャンネル名（部分一致）
   * @query {string} [modulation] - モジュレーション（完全一致）
   * @query {number} [minDuration] - 最小受信秒数
   */
  router.get('/log', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    // フィルタパラメータを収集
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
   * DELETE /api/log - 受信ログをクリア
   */
  router.delete('/log', (req, res) => {
    scannerState.clearLog();
    res.json({ cleared: true });
  });

  // ------ 設定 ------

  /**
   * GET /api/config - 現在の設定を取得
   */
  router.get('/config', (req, res) => {
    // 安全な設定のみ返す
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
   * PUT /api/config - 設定を更新
   */
  router.put('/config', (req, res) => {
    const updates = req.body;

    // ファイル名テンプレートの更新
    if (updates.fileNaming && updates.fileNaming.template) {
      config.fileNaming.template = updates.fileNaming.template;
    }

    // 自動録音設定の更新
    if (updates.audio && updates.audio.autoRecord !== undefined) {
      config.audio.autoRecord = updates.audio.autoRecord;
      scannerState.autoRecordEnabled = updates.audio.autoRecord;
    }

    // 受信タイムアウトの更新
    if (updates.scanner && updates.scanner.receptionTimeoutMs) {
      config.scanner.receptionTimeoutMs = updates.scanner.receptionTimeoutMs;
    }

    res.json({ updated: true, config: req.body });
  });

  /**
   * POST /api/config/template-preview - テンプレートのプレビューを生成
   * @body {string} template - プレビュー対象のテンプレート文字列
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


