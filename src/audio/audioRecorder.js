/**
 * @fileoverview 音声録音管理
 * @description AudioStreamerと連携した録音の開始・停止・管理を行う。
 * SOXプロセスは直接起動せず、AudioStreamerのMP3出力を受け取ってファイルに保存する。
 * ディレクトリ階層を含むテンプレートにも対応する。
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { generateFilename, getUniqueFilename, fromReceptionData } = require('./fileNamer');

/**
 * 音声録音管理クラス
 * AudioStreamerの統合SOXプロセスから録音パイプを使ってファイルに保存する。
 * @extends EventEmitter
 * @fires AudioRecorder#recordingStart - 録音開始時
 * @fires AudioRecorder#recordingStop - 録音停止時
 * @fires AudioRecorder#recordingError - 録音エラー時
 */
class AudioRecorder extends EventEmitter {
  /**
   * @param {Object} audioConfig - 音声録音設定
   * @param {Object} fileNamingConfig - ファイル命名設定
   * @param {import('./audioStreamer')} audioStreamer - AudioStreamerインスタンス
   * @param {boolean} [mockMode=false] - モックモード
   */
  constructor(audioConfig, fileNamingConfig, audioStreamer, mockMode = false) {
    super();

    /** @type {Object} 音声設定 */
    this._audioConfig = audioConfig;

    /** @type {Object} ファイル命名設定 */
    this._fileNamingConfig = fileNamingConfig;

    /** @type {import('./audioStreamer')} AudioStreamerインスタンス */
    this._audioStreamer = audioStreamer;

    /** @type {boolean} モックモード */
    this._mockMode = mockMode;

    /** @type {boolean} 録音中フラグ */
    this._isRecording = false;

    /** @type {string|null} 現在の録音ファイルパス */
    this._currentFilePath = null;

    /** @type {Date|null} 録音開始時刻 */
    this._recordingStartTime = null;

    /** @type {Object|null} 現在の受信情報 */
    this._currentReception = null;

    // 録音ディレクトリの作成
    this._ensureRecordingsDir();
  }

  /**
   * 録音ディレクトリの存在を確認し、なければ作成する
   * @private
   */
  _ensureRecordingsDir() {
    const dir = this._audioConfig.recordingsDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[AudioRecorder] 録音ディレクトリを作成しました: ${dir}`);
    }
  }

  /**
   * 録音を開始する
   * AudioStreamerの録音パイプを使ってファイルに書き込む。
   * テンプレートにディレクトリ階層が含まれる場合、中間ディレクトリを自動作成する。
   * @param {Object} reception - 受信情報
   * @param {Date} startTime - 受信開始時刻
   */
  startRecording(reception, startTime) {
    if (this._isRecording) {
      console.log('[AudioRecorder] 既に録音中です。先に停止します。');
      this.stopRecording();
    }

    this._currentReception = reception;
    this._recordingStartTime = startTime || new Date();

    // ファイル名（相対パス）を生成
    const params = fromReceptionData(reception, this._recordingStartTime);
    params.ext = this._audioConfig.format || 'mp3';

    const relativePath = generateFilename(this._fileNamingConfig.template, params);
    const uniqueRelativePath = getUniqueFilename(this._audioConfig.recordingsDir, relativePath);

    // 絶対パスを構築
    this._currentFilePath = path.join(this._audioConfig.recordingsDir, uniqueRelativePath);

    // 中間ディレクトリを自動作成
    const fileDir = path.dirname(this._currentFilePath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
      console.log(`[AudioRecorder] サブディレクトリを作成しました: ${fileDir}`);
    }

    if (this._mockMode) {
      this._startMockRecording();
      return;
    }

    this._startPipeRecording();
  }

  /**
   * AudioStreamerの録音パイプを使って録音を開始する
   * @private
   */
  _startPipeRecording() {
    console.log(`[AudioRecorder] パイプ録音開始: ${this._currentFilePath}`);

    try {
      // AudioStreamerの録音パイプを開始
      this._audioStreamer.startRecordingPipe(this._currentFilePath);
      this._isRecording = true;

      this.emit('recordingStart', {
        filePath: this._currentFilePath,
        filename: this._getRelativePath(this._currentFilePath),
        reception: this._currentReception,
        startTime: this._recordingStartTime,
      });
    } catch (err) {
      console.error(`[AudioRecorder] 録音開始失敗:`, err.message);
      this.emit('recordingError', { error: err.message });
    }
  }

  /**
   * モック録音を開始する
   * @private
   */
  _startMockRecording() {
    console.log(`[AudioRecorder] モック録音開始: ${this._currentFilePath}`);
    this._isRecording = true;

    // モック用: 空のファイルを作成
    fs.writeFileSync(this._currentFilePath, '');

    this.emit('recordingStart', {
      filePath: this._currentFilePath,
      filename: this._getRelativePath(this._currentFilePath),
      reception: this._currentReception,
      startTime: this._recordingStartTime,
    });
  }

  /**
   * 録音を停止する
   * @returns {Object|null} 録音結果情報
   */
  stopRecording() {
    if (!this._isRecording) {
      return null;
    }

    const endTime = new Date();
    const duration = this._recordingStartTime
      ? (endTime - this._recordingStartTime) / 1000
      : 0;

    // AudioStreamerの録音パイプを停止
    if (!this._mockMode) {
      this._audioStreamer.stopRecordingPipe();
    }

    this._isRecording = false;

    const result = {
      filePath: this._currentFilePath,
      filename: this._getRelativePath(this._currentFilePath),
      reception: this._currentReception,
      startTime: this._recordingStartTime,
      endTime,
      durationSec: Math.round(duration * 10) / 10,
    };

    console.log(`[AudioRecorder] 録音停止: ${result.filename} (${result.durationSec}秒)`);

    this.emit('recordingStop', result);

    // 短すぎる録音（1秒未満）は削除
    if (duration < 1.0 && this._currentFilePath && fs.existsSync(this._currentFilePath)) {
      try {
        fs.unlinkSync(this._currentFilePath);
        console.log(`[AudioRecorder] 短時間録音を削除: ${result.filename}`);
      } catch {
        // 無視
      }
    }

    this._currentFilePath = null;
    this._currentReception = null;
    this._recordingStartTime = null;

    return result;
  }

  /**
   * 録音中かどうかを取得する
   * @returns {boolean}
   */
  isRecording() {
    return this._isRecording;
  }

  /**
   * 録音ファイル一覧を取得する（再帰的にサブディレクトリも検索）
   * @param {Object} [filters={}] - フィルタ条件
   * @param {string} [filters.dateFrom] - 開始日時（ISO形式）
   * @param {string} [filters.dateTo] - 終了日時（ISO形式）
   * @param {string} [filters.search] - ファイル名検索（部分一致）
   * @returns {Array<Object>} ファイル情報配列
   */
  getRecordings(filters = {}) {
    const dir = this._audioConfig.recordingsDir;

    if (!fs.existsSync(dir)) {
      return [];
    }

    // 再帰的にファイルを収集
    const files = this._collectRecordingFiles(dir, dir);

    // フィルタ適用
    let filtered = files;

    // 日時範囲フィルタ
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      if (!isNaN(from.getTime())) {
        filtered = filtered.filter((f) => new Date(f.createdAt) >= from);
      }
    }

    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      if (!isNaN(to.getTime())) {
        filtered = filtered.filter((f) => new Date(f.createdAt) <= to);
      }
    }

    // ファイル名検索フィルタ（部分一致、大文字小文字無視）
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter((f) => f.filename.toLowerCase().includes(searchLower));
    }

    // 作成日時の新しい順でソート
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return filtered;
  }

  /**
   * 指定ディレクトリ配下の録音ファイルを再帰的に収集する
   * @param {string} currentDir - 現在探索中のディレクトリ
   * @param {string} baseDir - 録音ベースディレクトリ（相対パス算出用）
   * @returns {Array<Object>} ファイル情報配列
   * @private
   */
  _collectRecordingFiles(currentDir, baseDir) {
    const results = [];
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac'];

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // サブディレクトリを再帰的に探索
        const subResults = this._collectRecordingFiles(fullPath, baseDir);
        results.push(...subResults);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (audioExtensions.includes(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            // ベースディレクトリからの相対パス（パス区切りを `/` に統一）
            const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
            results.push({
              filename: relativePath,
              size: stat.size,
              sizeFormatted: formatFileSize(stat.size),
              createdAt: stat.birthtime.toISOString(),
              modifiedAt: stat.mtime.toISOString(),
            });
          } catch {
            // statが取得できないファイルはスキップ
          }
        }
      }
    }

    return results;
  }

  /**
   * 録音ファイルのフルパスを取得する（サブディレクトリ対応）
   * @param {string} relativePath - ベースディレクトリからの相対パス
   * @returns {string|null} ファイルの絶対パス（存在しない場合はnull）
   */
  getRecordingPath(relativePath) {
    // パストラバーサル対策: 正規化して録音ディレクトリ外に出ないことを確認
    const normalizedPath = path.normalize(relativePath).replace(/\\/g, '/');

    // 先頭の `../` や絶対パスを拒否
    if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
      console.warn(`[AudioRecorder] パストラバーサルを検出: ${relativePath}`);
      return null;
    }

    const filePath = path.join(this._audioConfig.recordingsDir, normalizedPath);

    // 最終的に録音ディレクトリ内であることを確認
    const resolvedBase = path.resolve(this._audioConfig.recordingsDir);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedBase)) {
      console.warn(`[AudioRecorder] パストラバーサルを検出: ${relativePath}`);
      return null;
    }

    if (fs.existsSync(filePath)) {
      return filePath;
    }

    return null;
  }

  /**
   * 録音ファイルを削除する（サブディレクトリ対応）
   * @param {string} relativePath - ベースディレクトリからの相対パス
   * @returns {boolean} 削除成功
   */
  deleteRecording(relativePath) {
    const filePath = this.getRecordingPath(relativePath);
    if (filePath) {
      fs.unlinkSync(filePath);

      // 空になったサブディレクトリを自動削除
      this._removeEmptyParentDirs(path.dirname(filePath));

      return true;
    }
    return false;
  }

  /**
   * 空の親ディレクトリを再帰的に削除する（録音ベースディレクトリまで）
   * @param {string} dir - チェック対象ディレクトリ
   * @private
   */
  _removeEmptyParentDirs(dir) {
    const baseDir = path.resolve(this._audioConfig.recordingsDir);
    const resolvedDir = path.resolve(dir);

    // ベースディレクトリ自体は削除しない
    if (resolvedDir === baseDir || !resolvedDir.startsWith(baseDir)) {
      return;
    }

    try {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        console.log(`[AudioRecorder] 空ディレクトリを削除: ${dir}`);
        // 親ディレクトリもチェック
        this._removeEmptyParentDirs(path.dirname(dir));
      }
    } catch {
      // 無視
    }
  }

  /**
   * 絶対パスからベースディレクトリ相対のパスを取得する
   * @param {string} absolutePath - 絶対パス
   * @returns {string} 相対パス（`/`区切り）
   * @private
   */
  _getRelativePath(absolutePath) {
    return path.relative(this._audioConfig.recordingsDir, absolutePath).replace(/\\/g, '/');
  }

  /**
   * リソースを解放する
   */
  destroy() {
    this.stopRecording();
    this.removeAllListeners();
  }
}

/**
 * ファイルサイズを読みやすい文字列に変換する
 * @param {number} bytes - バイト数
 * @returns {string} フォーマットされたサイズ文字列
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

module.exports = AudioRecorder;

