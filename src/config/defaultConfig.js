/**
 * @fileoverview BCT15X リモートスキャナー デフォルト設定
 * @description システム全体のデフォルト設定値を定義する
 */

const path = require('path');

/**
 * デフォルト設定オブジェクト
 * @type {Object}
 */
const defaultConfig = {
  /** サーバー設定 */
  server: {
    /** HTTPサーバーポート */
    port: parseInt(process.env.PORT, 10) || 3000,
    /** ホスト（0.0.0.0でDocker外からアクセス可能） */
    host: process.env.HOST || '0.0.0.0',
  },

  /** シリアルポート設定 */
  serial: {
    /** シリアルデバイスパス */
    path: process.env.SERIAL_PORT || '/dev/ttyUSB0',
    /** ボーレート（フロントポート: 115200bps） */
    baudRate: parseInt(process.env.SERIAL_BAUD, 10) || 115200,
    /** データビット */
    dataBits: 8,
    /** パリティ */
    parity: 'none',
    /** ストップビット */
    stopBits: 1,
    /** フロー制御 */
    rtscts: false,
    /** 行末文字 */
    delimiter: '\r',
  },

  /** スキャナーポーリング設定 */
  scanner: {
    /** GLGポーリング間隔(ms) */
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL, 10) || 200,
    /** STS取得間隔(ms) */
    statusIntervalMs: parseInt(process.env.STATUS_INTERVAL, 10) || 1000,
    /** 受信終了判定タイムアウト(ms) - この時間GLGが空なら受信終了とみなす */
    receptionTimeoutMs: parseInt(process.env.RECEPTION_TIMEOUT, 10) || 1500,
    /** 接続リトライ間隔(ms) */
    reconnectIntervalMs: 5000,
    /** 最大受信ログ件数 */
    maxLogEntries: parseInt(process.env.MAX_LOG_ENTRIES, 10) || 10000,
  },

  /** 音声録音設定 */
  audio: {
    /** ALSAデバイス名 */
    device: process.env.AUDIO_DEVICE || 'hw:1,0',
    /** 録音フォーマット（mp3） */
    format: process.env.AUDIO_FORMAT || 'mp3',
    /** サンプルレート */
    sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE, 10) || 22050,
    /** チャンネル数（1=モノラル） */
    channels: parseInt(process.env.AUDIO_CHANNELS, 10) || 1,
    /** MP3ビットレート */
    mp3Bitrate: parseInt(process.env.AUDIO_BITRATE, 10) || 64,
    /** 録音保存ディレクトリ */
    recordingsDir: process.env.RECORDINGS_DIR || path.join(__dirname, '../../recordings'),
    /** 自動録音の有効/無効 */
    autoRecord: process.env.AUTO_RECORD !== 'false',
    /** SOX無音検出: 無音閾値（パーセント） */
    silenceThreshold: parseFloat(process.env.SILENCE_THRESHOLD) || 1.0,
    /** SOX無音検出: 無音継続時間（秒） */
    silenceDuration: parseFloat(process.env.SILENCE_DURATION) || 3.0,
  },

  /** ファイル命名設定 */
  fileNaming: {
    /** ファイル名テンプレート
     * 使用可能プレースホルダー:
     *   {date}       - 日付 (YYYY-MM-DD)
     *   {time}       - 時刻 (HH-mm-ss)
     *   {datetime}   - 日時 (YYYY-MM-DD_HH-mm-ss)
     *   {freq}       - 周波数 (例: 155.700MHz)
     *   {tgid}       - トークグループID
     *   {system}     - システム名 (NAME1)
     *   {department} - デパートメント名 (NAME2)
     *   {channel}    - チャンネル名 (NAME3)
     *   {modulation} - モジュレーション
     *   {seq}        - 連番
     */
    template: process.env.FILENAME_TEMPLATE || '{date}_{time}_{freq}_{system}_{channel}',
    /** 日付フォーマット */
    dateFormat: 'YYYY-MM-DD',
    /** 時刻フォーマット */
    timeFormat: 'HH-mm-ss',
  },

  /** Google Drive同期設定 */
  gdrive: {
    /** 同期有効/無効 */
    enabled: process.env.GDRIVE_ENABLED === 'true',
    /** rcloneリモート名 */
    remoteName: process.env.GDRIVE_REMOTE || 'gdrive',
    /** リモート先ディレクトリ */
    remotePath: process.env.GDRIVE_PATH || 'BCT15X_Recordings',
    /** 同期間隔（秒） */
    syncIntervalSec: parseInt(process.env.GDRIVE_SYNC_INTERVAL, 10) || 300,
  },

  /** モックモード（実機なしでのテスト用） */
  mock: {
    /** モックモード有効/無効 */
    enabled: process.env.MOCK_MODE === 'true',
  },
};

module.exports = defaultConfig;
