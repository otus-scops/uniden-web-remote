/**
 * @fileoverview BCT15X スキャナー状態管理
 * @description スキャナーの現在の状態と受信ログを管理する
 */

const EventEmitter = require('events');

/**
 * スキャナー状態を管理するクラス
 * @extends EventEmitter
 * @fires ScannerState#receptionStart - 受信開始時
 * @fires ScannerState#receptionEnd - 受信終了時
 * @fires ScannerState#statusUpdate - ステータス更新時
 */
class ScannerState extends EventEmitter {
  /**
   * @param {Object} config - 設定オブジェクト
   * @param {number} config.receptionTimeoutMs - 受信終了判定タイムアウト(ms)
   * @param {number} config.maxLogEntries - 最大ログ件数
   */
  constructor(config) {
    super();

    /** @type {Object} スキャナー設定 */
    this._config = config;

    /** @type {boolean} シリアルポート接続状態 */
    this.isConnected = false;

    /** @type {string} モデル名 */
    this.model = '';

    /** @type {string} ファームウェアバージョン */
    this.firmwareVersion = '';

    /** @type {boolean} 受信中フラグ */
    this.isReceiving = false;

    /** @type {Object|null} 現在の受信情報 */
    this.currentReception = null;

    /** @type {number} 現在のRSSI値 */
    this.rssi = 0;

    /** @type {Object|null} 最新のSTSレスポンス */
    this.latestSts = null;

    /** @type {Array<Object>} 受信ログ */
    this._receptionLog = [];

    /** @type {number|null} 受信終了判定タイマー */
    this._receptionTimeout = null;

    /** @type {Date|null} 現在の受信開始時刻 */
    this._receptionStartTime = null;

    /** @type {boolean} 録音中フラグ */
    this.isRecording = false;

    /** @type {boolean} 自動録音有効フラグ */
    this.autoRecordEnabled = true;
  }

  /**
   * GLGデータに基づいて状態を更新する
   * @param {Object} glgData - parseGlgResponseの結果
   */
  onGlgUpdate(glgData) {
    if (!glgData) {
      return;
    }

    if (glgData.isReceiving) {
      this._onSignalDetected(glgData);
    } else {
      this._onNoSignal();
    }

    this.emit('statusUpdate', this.getStatus());
  }

  /**
   * 信号検出時の処理
   * @param {Object} glgData - GLGパース結果
   * @private
   */
  _onSignalDetected(glgData) {
    // 受信終了タイマーをリセット
    this._clearReceptionTimeout();

    const isNewReception = !this.isReceiving;

    this.isReceiving = true;
    this.currentReception = {
      rawFreqTgid: glgData.rawFreqTgid,
      freqTgid: glgData.freqTgid,
      freqForFilename: glgData.freqForFilename,
      modulation: glgData.modulation,
      attenuator: glgData.attenuator,
      ctcssDcs: glgData.ctcssDcs,
      system: glgData.name1,
      department: glgData.name2,
      channel: glgData.name3,
      squelch: glgData.squelch,
      mute: glgData.mute,
      sysTag: glgData.sysTag,
      chanTag: glgData.chanTag,
      p25nac: glgData.p25nac,
    };

    if (isNewReception) {
      this._receptionStartTime = new Date();

      /**
       * 受信開始イベント
       * @event ScannerState#receptionStart
       * @type {Object}
       * @property {Object} reception - 受信情報
       * @property {Date} startTime - 受信開始時刻
       */
      this.emit('receptionStart', {
        reception: { ...this.currentReception },
        startTime: this._receptionStartTime,
      });
    }

    // 受信終了判定タイマーを設定
    this._setReceptionTimeout();
  }

  /**
   * 信号なし時の処理
   * @private
   */
  _onNoSignal() {
    // タイマーが既に動いていれば何もしない（タイムアウトで受信終了を判定）
    if (!this.isReceiving) {
      this.currentReception = null;
    }
  }

  /**
   * 受信終了タイマーを設定する
   * @private
   */
  _setReceptionTimeout() {
    this._clearReceptionTimeout();
    this._receptionTimeout = setTimeout(() => {
      this._onReceptionEnd();
    }, this._config.receptionTimeoutMs);
  }

  /**
   * 受信終了タイマーをクリアする
   * @private
   */
  _clearReceptionTimeout() {
    if (this._receptionTimeout) {
      clearTimeout(this._receptionTimeout);
      this._receptionTimeout = null;
    }
  }

  /**
   * 受信終了時の処理
   * @private
   */
  _onReceptionEnd() {
    if (!this.isReceiving) {
      return;
    }

    const endTime = new Date();
    const duration = this._receptionStartTime
      ? (endTime - this._receptionStartTime) / 1000
      : 0;

    const logEntry = {
      id: Date.now(),
      startTime: this._receptionStartTime ? this._receptionStartTime.toISOString() : null,
      endTime: endTime.toISOString(),
      durationSec: Math.round(duration * 10) / 10,
      ...this.currentReception,
    };

    // ログに追加
    this._receptionLog.unshift(logEntry);

    // 最大件数を超えたら古いものを削除
    if (this._receptionLog.length > this._config.maxLogEntries) {
      this._receptionLog = this._receptionLog.slice(0, this._config.maxLogEntries);
    }

    /**
     * 受信終了イベント
     * @event ScannerState#receptionEnd
     * @type {Object}
     * @property {Object} reception - 受信情報
     * @property {Date} startTime - 受信開始時刻
     * @property {Date} endTime - 受信終了時刻
     * @property {number} durationSec - 受信時間（秒）
     */
    this.emit('receptionEnd', {
      reception: { ...this.currentReception },
      startTime: this._receptionStartTime,
      endTime,
      durationSec: duration,
      logEntry,
    });

    this.isReceiving = false;
    this.currentReception = null;
    this._receptionStartTime = null;

    this.emit('statusUpdate', this.getStatus());
  }

  /**
   * RSSI値を更新する
   * @param {number} rssi - RSSI値
   */
  onRssiUpdate(rssi) {
    this.rssi = rssi;
  }

  /**
   * STSデータを更新する
   * @param {Object} stsData - parseStsResponseの結果
   */
  onStsUpdate(stsData) {
    this.latestSts = stsData;
  }

  /**
   * 接続状態を更新する
   * @param {boolean} connected - 接続状態
   */
  setConnected(connected) {
    this.isConnected = connected;
    this.emit('statusUpdate', this.getStatus());
  }

  /**
   * モデル情報を設定する
   * @param {string} model - モデル名
   */
  setModel(model) {
    this.model = model;
  }

  /**
   * ファームウェアバージョンを設定する
   * @param {string} version - バージョン文字列
   */
  setFirmwareVersion(version) {
    this.firmwareVersion = version;
  }

  /**
   * 録音状態を更新する
   * @param {boolean} isRecording - 録音中かどうか
   */
  setRecording(isRecording) {
    this.isRecording = isRecording;
    this.emit('statusUpdate', this.getStatus());
  }

  /**
   * 現在のスキャナーステータスを取得する
   * @returns {Object} ステータスオブジェクト
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      model: this.model,
      firmwareVersion: this.firmwareVersion,
      isReceiving: this.isReceiving,
      isRecording: this.isRecording,
      autoRecordEnabled: this.autoRecordEnabled,
      rssi: this.rssi,
      currentReception: this.currentReception ? { ...this.currentReception } : null,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 受信ログを取得する（フィルタリング対応）
   * @param {number} [limit=100] - 取得件数
   * @param {number} [offset=0] - オフセット
   * @param {Object} [filters={}] - フィルタ条件
   * @param {string} [filters.dateFrom] - 開始日時（ISO形式）
   * @param {string} [filters.dateTo] - 終了日時（ISO形式）
   * @param {string} [filters.freq] - 周波数/TGID（部分一致）
   * @param {string} [filters.system] - システム名（部分一致）
   * @param {string} [filters.channel] - チャンネル名（部分一致）
   * @param {string} [filters.modulation] - モジュレーション（完全一致）
   * @param {number} [filters.minDuration] - 最小受信秒数
   * @returns {Object} ログ情報
   * @property {Array<Object>} entries - ログエントリー配列
   * @property {number} total - フィルタ後の総件数
   * @property {number} totalUnfiltered - フィルタ前の総件数
   */
  getLog(limit = 100, offset = 0, filters = {}) {
    let entries = this._receptionLog;

    // フィルタ適用
    const hasFilters = Object.keys(filters).some((key) => filters[key] !== undefined && filters[key] !== '');

    if (hasFilters) {
      entries = entries.filter((entry) => {
        // 日時範囲フィルタ
        if (filters.dateFrom) {
          const from = new Date(filters.dateFrom);
          if (!isNaN(from.getTime()) && entry.startTime) {
            if (new Date(entry.startTime) < from) return false;
          }
        }

        if (filters.dateTo) {
          const to = new Date(filters.dateTo);
          if (!isNaN(to.getTime()) && entry.startTime) {
            if (new Date(entry.startTime) > to) return false;
          }
        }

        // 周波数/TGID フィルタ（部分一致、大文字小文字無視）
        if (filters.freq) {
          const freqLower = filters.freq.toLowerCase();
          const entryFreq = (entry.freqTgid || entry.rawFreqTgid || '').toLowerCase();
          if (!entryFreq.includes(freqLower)) return false;
        }

        // システム名フィルタ（部分一致、大文字小文字無視）
        if (filters.system) {
          const systemLower = filters.system.toLowerCase();
          const entrySystem = (entry.system || '').toLowerCase();
          if (!entrySystem.includes(systemLower)) return false;
        }

        // チャンネル名フィルタ（部分一致、大文字小文字無視）
        if (filters.channel) {
          const channelLower = filters.channel.toLowerCase();
          const entryChannel = (entry.channel || '').toLowerCase();
          if (!entryChannel.includes(channelLower)) return false;
        }

        // モジュレーション フィルタ（完全一致、大文字小文字無視）
        if (filters.modulation) {
          const modLower = filters.modulation.toLowerCase();
          const entryMod = (entry.modulation || '').toLowerCase();
          if (entryMod !== modLower) return false;
        }

        // 最小受信秒数フィルタ
        if (filters.minDuration !== undefined && filters.minDuration !== '') {
          const minDur = parseFloat(filters.minDuration);
          if (!isNaN(minDur) && (entry.durationSec || 0) < minDur) return false;
        }

        return true;
      });
    }

    return {
      entries: entries.slice(offset, offset + limit),
      total: entries.length,
      totalUnfiltered: this._receptionLog.length,
    };
  }

  /**
   * 受信ログをクリアする
   */
  clearLog() {
    this._receptionLog = [];
  }

  /**
   * リソースを解放する
   */
  destroy() {
    this._clearReceptionTimeout();
    this.removeAllListeners();
  }
}

module.exports = ScannerState;
