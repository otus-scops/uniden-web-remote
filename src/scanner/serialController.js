/**
 * @fileoverview BCT15X シリアル通信コントローラー
 * @description BCT15Xとのシリアルポート通信を管理し、コマンド送受信を行う
 */

const EventEmitter = require('events');
const { parseResponse, parseGlgResponse, parsePwrResponse } = require('./protocolParser');

/**
 * BCT15Xシリアル通信コントローラー
 * @extends EventEmitter
 * @fires SerialController#data - データ受信時
 * @fires SerialController#connected - 接続時
 * @fires SerialController#disconnected - 切断時
 * @fires SerialController#error - エラー時
 */
class SerialController extends EventEmitter {
  /**
   * @param {Object} config - シリアルポート設定
   * @param {string} config.path - デバイスパス
   * @param {number} config.baudRate - ボーレート
   * @param {boolean} [mockMode=false] - モックモード
   */
  constructor(config, mockMode = false) {
    super();

    /** @type {Object} 設定 */
    this._config = config;

    /** @type {boolean} モックモード */
    this._mockMode = mockMode;

    /** @type {Object|null} SerialPortインスタンス */
    this._port = null;

    /** @type {Object|null} パーサー */
    this._parser = null;

    /** @type {boolean} 接続状態 */
    this._isConnected = false;

    /** @type {number|null} GLGポーリングタイマー */
    this._pollTimer = null;

    /** @type {number|null} PWRポーリングタイマー */
    this._pwrTimer = null;

    /** @type {Array<Function>} コマンド応答待ちキュー */
    this._responseQueue = [];

    /** @type {number} モック用受信カウンター */
    this._mockCounter = 0;

    /** @type {boolean} モック用受信中フラグ */
    this._mockReceiving = false;
  }

  /**
   * シリアルポートに接続する
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._mockMode) {
      return this._connectMock();
    }

    try {
      // serialportモジュールを動的にロード（Dockerの場合のみインストール済み）
      const { SerialPort } = require('serialport');
      const { ReadlineParser } = require('@serialport/parser-readline');

      this._port = new SerialPort({
        path: this._config.path,
        baudRate: this._config.baudRate,
        dataBits: this._config.dataBits || 8,
        parity: this._config.parity || 'none',
        stopBits: this._config.stopBits || 1,
        rtscts: this._config.rtscts || false,
      });

      this._parser = this._port.pipe(
        new ReadlineParser({ delimiter: this._config.delimiter || '\r' })
      );

      // データ受信ハンドラー
      this._parser.on('data', (data) => {
        this._onData(data);
      });

      // 接続イベント
      this._port.on('open', () => {
        this._isConnected = true;
        console.log(`[SerialController] ポートに接続しました: ${this._config.path}`);
        this.emit('connected');
      });

      // エラーハンドラー
      this._port.on('error', (err) => {
        console.error(`[SerialController] シリアルエラー:`, err.message);
        this.emit('error', err);
      });

      // クローズハンドラー
      this._port.on('close', () => {
        this._isConnected = false;
        console.log('[SerialController] ポートが切断されました');
        this.emit('disconnected');
      });

      // 接続完了を待つ
      await new Promise((resolve, reject) => {
        this._port.on('open', resolve);
        this._port.on('error', reject);
      });
    } catch (err) {
      console.error('[SerialController] 接続に失敗しました:', err.message);
      throw err;
    }
  }

  /**
   * モックモードで接続する
   * @private
   */
  _connectMock() {
    console.log('[SerialController] モックモードで接続しました');
    this._isConnected = true;
    this.emit('connected');
  }

  /**
   * シリアルポートを切断する
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.stopPolling();

    if (this._mockMode) {
      this._isConnected = false;
      this.emit('disconnected');
      return;
    }

    if (this._port && this._port.isOpen) {
      return new Promise((resolve) => {
        this._port.close(() => {
          this._isConnected = false;
          this.emit('disconnected');
          resolve();
        });
      });
    }
  }

  /**
   * 接続状態を取得する
   * @returns {boolean}
   */
  isConnected() {
    return this._isConnected;
  }

  /**
   * コマンドを送信する
   * @param {string} command - 送信コマンド（\rは自動付加）
   * @returns {Promise<string>} レスポンス文字列
   */
  async sendCommand(command) {
    if (this._mockMode) {
      return this._mockCommand(command);
    }

    if (!this._isConnected || !this._port) {
      throw new Error('シリアルポートに接続されていません');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // キューから削除
        const idx = this._responseQueue.indexOf(resolver);
        if (idx >= 0) {
          this._responseQueue.splice(idx, 1);
        }
        reject(new Error(`コマンドタイムアウト: ${command}`));
      }, 3000);

      const resolver = (data) => {
        clearTimeout(timeout);
        resolve(data);
      };

      this._responseQueue.push(resolver);

      const cmdStr = command.endsWith('\r') ? command : command + '\r';
      this._port.write(cmdStr, (err) => {
        if (err) {
          clearTimeout(timeout);
          const idx = this._responseQueue.indexOf(resolver);
          if (idx >= 0) {
            this._responseQueue.splice(idx, 1);
          }
          reject(err);
        }
      });
    });
  }

  /**
   * データ受信ハンドラー
   * @param {string} data - 受信データ
   * @private
   */
  _onData(data) {
    const trimmed = data.trim();
    if (!trimmed) {
      return;
    }

    // 応答待ちキューにリゾルバーがあればそちらに渡す
    if (this._responseQueue.length > 0) {
      const resolver = this._responseQueue.shift();
      resolver(trimmed);
    }

    // 全データをイベントとして配信
    this.emit('data', trimmed);
  }

  /**
   * GLG/PWRの定期ポーリングを開始する
   * @param {number} glgIntervalMs - GLGポーリング間隔(ms)
   * @param {number} [pwrIntervalMs=500] - PWRポーリング間隔(ms)
   */
  startPolling(glgIntervalMs, pwrIntervalMs = 500) {
    this.stopPolling();

    // GLGポーリング
    this._pollTimer = setInterval(async () => {
      try {
        const response = await this.sendCommand('GLG');
        const parsed = parseGlgResponse(response);
        this.emit('glgUpdate', parsed);
      } catch {
        // タイムアウトは無視
      }
    }, glgIntervalMs);

    // PWRポーリング（RSSI）
    this._pwrTimer = setInterval(async () => {
      try {
        const response = await this.sendCommand('PWR');
        const parsed = parsePwrResponse(response);
        if (parsed) {
          this.emit('pwrUpdate', parsed);
        }
      } catch {
        // タイムアウトは無視
      }
    }, pwrIntervalMs);

    console.log(`[SerialController] ポーリング開始: GLG=${glgIntervalMs}ms, PWR=${pwrIntervalMs}ms`);
  }

  /**
   * ポーリングを停止する
   */
  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._pwrTimer) {
      clearInterval(this._pwrTimer);
      this._pwrTimer = null;
    }
  }

  /**
   * キープレスをシミュレートする
   * @param {string} key - キー名（例: "S", "H", "L", "1"-"9"）
   * @param {string} [action="P"] - アクション（P=Press, H=Hold, R=Release）
   * @returns {Promise<string>}
   */
  async pressKey(key, action = 'P') {
    return this.sendCommand(`KEY,${key},${action}`);
  }

  /**
   * スキャンを開始する（Scanキーを押す）
   * @returns {Promise<string>}
   */
  async startScan() {
    return this.pressKey('S', 'P');
  }

  /**
   * ホールドする（Holdキーを押す）
   * @returns {Promise<string>}
   */
  async hold() {
    return this.pressKey('H', 'P');
  }

  /**
   * 音量を設定する
   * @param {number} level - 音量レベル (0-15)
   * @returns {Promise<string>}
   */
  async setVolume(level) {
    // 0埋めの2桁にする (例: 5 -> 05, 12 -> 12)
    const formatted = String(level).padStart(2, '0');
    return this.sendCommand(`VOL,${formatted}`);
  }

  /**
   * スケルチを設定する
   * @param {number} level - スケルチレベル (0-15)
   * @returns {Promise<string>}
   */
  async setSquelch(level) {
    const formatted = String(level).padStart(2, '0');
    return this.sendCommand(`SQL,${formatted}`);
  }

  /**
   * モデル情報を取得する
   * @returns {Promise<string>}
   */
  async getModel() {
    return this.sendCommand('MDL');
  }

  /**
   * ファームウェアバージョンを取得する
   * @returns {Promise<string>}
   */
  async getVersion() {
    return this.sendCommand('VER');
  }

  /**
   * モックコマンド応答を生成する
   * @param {string} command - コマンド名
   * @returns {string} モック応答
   * @private
   */
  _mockCommand(command) {
    const cmd = command.replace('\r', '').trim();

    switch (cmd) {
      case 'MDL':
        return 'MDL,BCT15X';

      case 'VER':
        return 'VER,Version 1.03.00';

      case 'GLG':
        return this._mockGlgResponse();

      case 'PWR':
        return this._mockReceiving ? `PWR,${Math.floor(Math.random() * 5) + 2}` : 'PWR,0';

      case 'STS':
        return 'STS,011000,,,155.7000,FM,Auto Police,East Precinct,Dispatch,,0';

      default:
        if (cmd.startsWith('KEY')) {
          return 'OK';
        }
        return 'OK';
    }
  }

  /**
   * モックGLGレスポンスを生成する（受信と非受信を周期的に繰り返す）
   * @returns {string}
   * @private
   */
  _mockGlgResponse() {
    this._mockCounter++;

    // 約5秒ごとに受信状態を切り替える（200msポーリングで25回）
    const cycle = this._mockCounter % 50;

    if (cycle < 25) {
      // 受信中
      this._mockReceiving = true;
      const freqs = ['01557000', '04620000', '15180000', '08510125'];
      const systems = ['Auto Police', 'Fire Dept', 'EMS', 'Highway Patrol'];
      const channels = ['Dispatch', 'Tactical', 'Command', 'Patrol'];
      const depts = ['East', 'West', 'North', 'Central'];
      const mods = ['FM', 'NFM', 'AM', 'P25'];
      const idx = Math.floor(this._mockCounter / 50) % freqs.length;

      return `GLG,${freqs[idx]},${mods[idx]},OFF,none,${systems[idx]},${depts[idx]},${channels[idx]},0,0,1,1,`;
    } else {
      // 非受信
      this._mockReceiving = false;
      return 'GLG,,,,,,,,,,,,';
    }
  }

  /**
   * リソースを解放する
   */
  destroy() {
    this.stopPolling();
    this.removeAllListeners();
    if (this._port && this._port.isOpen) {
      this._port.close();
    }
  }
}

module.exports = SerialController;
