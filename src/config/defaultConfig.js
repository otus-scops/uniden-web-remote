/**
 * @fileoverview BCT15X Remote Scanner Default Configuration
 * @description Defines system-wide default configuration parameters and environment variable fallbacks
 */

const path = require('path');

/**
 * Default configuration object
 * @type {Object}
 */
const defaultConfig = {
  /** Server settings */
  server: {
    /** HTTP web server port */
    port: parseInt(process.env.PORT, 10) || 3000,
    /** Bind host (0.0.0.0 for Docker container accessibility) */
    host: process.env.HOST || '0.0.0.0',
  },

  /** Serial port communication settings */
  serial: {
    /** Serial device path */
    path: process.env.SERIAL_PORT || '/dev/ttyUSB0',
    /** Baud rate (BCT15X front port default: 115200bps) */
    baudRate: parseInt(process.env.SERIAL_BAUD, 10) || 115200,
    /** Data bits */
    dataBits: 8,
    /** Parity */
    parity: 'none',
    /** Stop bits */
    stopBits: 1,
    /** Hardware flow control */
    rtscts: false,
    /** Line delimiter */
    delimiter: '\r',
  },

  /** Scanner polling settings */
  scanner: {
    /** GLG polling interval (ms) */
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL, 10) || 200,
    /** STS polling interval (ms) */
    statusIntervalMs: parseInt(process.env.STATUS_INTERVAL, 10) || 1000,
    /** Reception timeout threshold (ms) - mark signal end if GLG empty for this duration */
    receptionTimeoutMs: parseInt(process.env.RECEPTION_TIMEOUT, 10) || 1500,
    /** Serial reconnection retry interval (ms) */
    reconnectIntervalMs: 5000,
    /** Maximum activity log entries retained in memory */
    maxLogEntries: parseInt(process.env.MAX_LOG_ENTRIES, 10) || 10000,
    /** Maximum consecutive reception duration (seconds) before forcing scan resume (0 = disabled/OFF) */
    maxReceptionDurationSec: parseInt(process.env.MAX_RECEPTION_DURATION_SEC, 10) || 0,
  },

  /** Audio streaming and recording settings */
  audio: {
    /** ALSA capture device name */
    device: process.env.AUDIO_DEVICE || 'hw:1,0',
    /** Audio format (mp3) */
    format: process.env.AUDIO_FORMAT || 'mp3',
    /** Audio sample rate (Hz) - 16000Hz is optimal for scanner voice communications */
    sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE, 10) || 16000,
    /** Channels (1 = Mono) */
    channels: parseInt(process.env.AUDIO_CHANNELS, 10) || 1,
    /** MP3 bitrate (kbps) - 32kbps Mono cuts file size by 50% while preserving clear voice */
    mp3Bitrate: parseInt(process.env.AUDIO_BITRATE, 10) || 32,
    /** Persistent recordings directory */
    recordingsDir: process.env.RECORDINGS_DIR || path.join(__dirname, '../../recordings'),
    /** Auto recording enabled flag */
    autoRecord: process.env.AUTO_RECORD !== 'false',
    /** SoX silence threshold (percentage) */
    silenceThreshold: parseFloat(process.env.SILENCE_THRESHOLD) || 1.0,
    /** SoX silence duration (seconds) */
    silenceDuration: parseFloat(process.env.SILENCE_DURATION) || 3.0,
    /** Automatic storage retention settings */
    retention: {
      /** Number of days to retain recordings (0 = keep forever, default: 30 days) */
      retentionDays: parseInt(process.env.RETENTION_DAYS, 10) || 30,
      /** Maximum storage capacity in megabytes (0 = unlimited) */
      maxStorageMb: parseInt(process.env.MAX_STORAGE_MB, 10) || 0,
      /** Cleanup job interval in hours */
      cleanupIntervalHours: parseInt(process.env.CLEANUP_INTERVAL_HOURS, 10) || 12,
    },
  },

  /** Filename template settings */
  fileNaming: {
    /** Filename template pattern
     * Available placeholders:
     *   {date}       - Date (YYYY-MM-DD)
     *   {time}       - Time (HH-mm-ss)
     *   {datetime}   - Date and time (YYYY-MM-DD_HH-mm-ss)
     *   {freq}       - Frequency (e.g. 155.700MHz)
     *   {tgid}       - Talkgroup ID
     *   {system}     - System tag (NAME1)
     *   {department} - Department tag (NAME2)
     *   {channel}    - Channel tag (NAME3)
     *   {modulation} - Modulation mode
     *   {seq}        - Sequential number
     */
    template: process.env.FILENAME_TEMPLATE || '{system}/{department}/{channel}/{date}_{time}_{freq}',
    /** Date format */
    dateFormat: 'YYYY-MM-DD',
    /** Time format */
    timeFormat: 'HH-mm-ss',
  },

  /** Authentication & Role-based Access Control settings */
  auth: {
    /** Enable / disable authentication (disabled by default) */
    enabled: process.env.AUTH_ENABLED === 'true',
    /** Operator (Admin) password with full control & editing privileges */
    operatorPassword: process.env.ADMIN_PASSWORD || process.env.OPERATOR_PASSWORD || '',
    /** Listener (Guest) password (leave empty to allow public listen-only access) */
    listenerPassword: process.env.LISTENER_PASSWORD || '',
    /** Secret key for token verification */
    secret: process.env.AUTH_SECRET || 'bct15x-uniden-auth-secret-key',
  },

  /** Google Drive synchronization settings (Optional) */
  gdrive: {
    /** Enable / disable sync */
    enabled: process.env.GDRIVE_ENABLED === 'true',
    /** rclone remote name */
    remoteName: process.env.GDRIVE_REMOTE || 'gdrive',
    /** Remote target directory path */
    remotePath: process.env.GDRIVE_PATH || 'BCT15X_Recordings',
    /** Sync interval (seconds) */
    syncIntervalSec: parseInt(process.env.GDRIVE_SYNC_INTERVAL, 10) || 300,
  },

  /** Mock simulation mode (for UI testing without scanner hardware) */
  mock: {
    /** Enable / disable mock mode */
    enabled: process.env.MOCK_MODE === 'true',
  },
};

module.exports = defaultConfig;
