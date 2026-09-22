/**
 * @fileoverview ライブ音声ストリーミング＆録音統合モジュール
 * @description SOXを用いた音声キャプチャを行い、HTTPストリーミング配信と
 * ファイル録音の両方に対応する。1つのSOXプロセスの出力を複数系統に分岐配信する。
 */

const EventEmitter = require('events');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const fs = require('fs');

/**
 * ライブ音声ストリーミング＆録音統合管理クラス
 * SOXで音声をキャプチャし、MP3ストリームとして複数クライアントに配信しつつ、
 * 同時にファイル録音を行う。
 * @extends EventEmitter
 * @fires AudioStreamer#clientConnected - クライアント接続時
 * @fires AudioStreamer#clientDisconnected - クライアント切断時
 * @fires AudioStreamer#streamStart - ストリーミング開始時
 * @fires AudioStreamer#streamStop - ストリーミング停止時
 * @fires AudioStreamer#streamError - ストリーミングエラー時
 * @fires AudioStreamer#recordingPipeStart - 録音パイプ開始時
 * @fires AudioStreamer#recordingPipeStop - 録音パイプ停止時
 */
class AudioStreamer extends EventEmitter {
  /**
   * @param {Object} audioConfig - 音声設定
   * @param {string} audioConfig.device - ALSAデバイス名（例: "hw:1,0"）
   * @param {number} audioConfig.sampleRate - サンプルレート
   * @param {number} audioConfig.channels - チャンネル数
   * @param {number} audioConfig.mp3Bitrate - MP3ビットレート(kbps)
   * @param {boolean} [mockMode=false] - モックモード
   */
  constructor(audioConfig, mockMode = false) {
    super();

    /** @type {Object} 音声設定 */
    this._audioConfig = audioConfig;

    /** @type {boolean} モックモード */
    this._mockMode = mockMode;

    /** @type {import('child_process').ChildProcess|null} SOXプロセス */
    this._soxProcess = null;

    /** @type {boolean} ストリーミング中フラグ */
    this._isStreaming = false;

    /** @type {Set<PassThrough>} 接続中クライアントのストリーム */
    this._clients = new Set();

    /** @type {number|null} モック用タイマー */
    this._mockTimer = null;

    /** @type {Buffer|null} モック用MP3無音フレーム */
    this._mockSilenceFrame = null;

    /** @type {boolean} 意図的な停止かどうか（closeイベント競合防止用） */
    this._intentionalStop = false;

    /** @type {Promise<void>|null} SOXプロセス終了待ちPromise */
    this._stopPromise = null;

    /** @type {fs.WriteStream|null} 録音用ファイルストリーム */
    this._recordingStream = null;

    /** @type {string|null} 現在の録音ファイルパス */
    this._recordingFilePath = null;

    /** @type {boolean} 録音中フラグ */
    this._isRecording = false;
  }

  /**
   * ストリーミング中かどうかを取得する
   * @returns {boolean}
   */
  isStreaming() {
    return this._isStreaming;
  }

  /**
   * 録音中かどうかを取得する
   * @returns {boolean}
   */
  isRecording() {
    return this._isRecording;
  }

  /**
   * 接続中クライアント数を取得する
   * @returns {number}
   */
  getClientCount() {
    return this._clients.size;
  }

  /**
   * 新しいクライアントストリームを作成し、音声データの配信を開始する。
   * クライアントが接続されたらSOXプロセスを起動する（まだ起動していなければ）。
   * @returns {PassThrough} クライアント用のReadableストリーム
   */
  addClient() {
    const clientStream = new PassThrough();

    this._clients.add(clientStream);

    // クライアントストリームが閉じられたらセットから除去
    clientStream.on('close', () => {
      this._removeClient(clientStream);
    });

    clientStream.on('error', () => {
      this._removeClient(clientStream);
    });

    console.log(`[AudioStreamer] クライアント接続 (現在: ${this._clients.size})`);
    this.emit('clientConnected', { clientCount: this._clients.size });

    // ストリーミングがまだ開始されていなければ開始する
    if (!this._isStreaming) {
      this._startStreaming();
    }

    return clientStream;
  }

  /**
   * クライアントストリームを除去する
   * @param {PassThrough} clientStream - 除去するストリーム
   * @private
   */
  _removeClient(clientStream) {
    if (!this._clients.has(clientStream)) {
      return;
    }

    this._clients.delete(clientStream);
    console.log(`[AudioStreamer] クライアント切断 (残り: ${this._clients.size})`);
    this.emit('clientDisconnected', { clientCount: this._clients.size });

    // 全クライアントが切断され、かつ録音中でなければストリーミングを停止する
    if (this._clients.size === 0 && !this._isRecording) {
      this._stopStreaming();
    }
  }

  /**
   * 録音パイプを開始する（SOXの出力をファイルにも書き込む）
   * SOXプロセスが未起動なら起動する。
   * @param {string} filePath - 録音ファイルパス
   */
  startRecordingPipe(filePath) {
    if (this._isRecording) {
      console.log('[AudioStreamer] 既に録音パイプ中です。先に停止します。');
      this.stopRecordingPipe();
    }

    this._recordingFilePath = filePath;

    try {
      this._recordingStream = fs.createWriteStream(filePath);
      this._isRecording = true;

      this._recordingStream.on('error', (err) => {
        console.error(`[AudioStreamer] 録音ファイル書き込みエラー:`, err.message);
        this.stopRecordingPipe();
      });

      console.log(`[AudioStreamer] 録音パイプ開始: ${filePath}`);
      this.emit('recordingPipeStart', { filePath });

      // SOXプロセスが未起動なら起動する
      if (!this._isStreaming) {
        this._startStreaming();
      }
    } catch (err) {
      console.error(`[AudioStreamer] 録音パイプ開始失敗:`, err.message);
      this._isRecording = false;
      this._recordingStream = null;
      this._recordingFilePath = null;
    }
  }

  /**
   * 録音パイプを停止する（ファイル書き込みを終了）
   * @returns {Object|null} 録音結果情報
   */
  stopRecordingPipe() {
    if (!this._isRecording) {
      return null;
    }

    const filePath = this._recordingFilePath;

    // ファイルストリームを閉じる
    if (this._recordingStream) {
      try {
        this._recordingStream.end();
      } catch (err) {
        console.error(`[AudioStreamer] 録音ストリーム終了エラー:`, err.message);
      }
      this._recordingStream = null;
    }

    this._isRecording = false;
    this._recordingFilePath = null;

    console.log(`[AudioStreamer] 録音パイプ停止: ${filePath}`);
    this.emit('recordingPipeStop', { filePath });

    // 全クライアントも切断されていればSOXも停止
    if (this._clients.size === 0) {
      this._stopStreaming();
    }

    return { filePath };
  }

  /**
   * ストリーミングを開始する（SOXプロセスを起動）
   * 前回のSOXプロセスが終了中の場合は完了を待ってから起動する。
   * @private
   */
  async _startStreaming() {
    if (this._isStreaming) {
      return;
    }

    // 前回のSOX終了を待つ
    if (this._stopPromise) {
      console.log('[AudioStreamer] 前回のSOXプロセス終了を待機中...');
      try {
        await this._stopPromise;
      } catch {
        // 無視して続行
      }
      this._stopPromise = null;
    }

    if (this._mockMode) {
      this._startMockStreaming();
      return;
    }

    this._startSoxStreaming();
  }

  /**
   * SOXによるリアル音声ストリーミングを開始する
   * @private
   */
  _startSoxStreaming() {
    const args = this._buildSoxStreamArgs();

    console.log(`[AudioStreamer] SOXストリーミング開始: sox ${args.join(' ')}`);

    try {
      this._intentionalStop = false;

      this._soxProcess = spawn('sox', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this._isStreaming = true;

      // SOXのstdoutからMP3データを読み取り、全クライアントと録音に配信
      this._soxProcess.stdout.on('data', (chunk) => {
        this._broadcastChunk(chunk);
      });

      this._soxProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        // SOXの通常の進捗メッセージはフィルタリング
        if (msg && !msg.includes('In:') && !msg.includes('Input File')) {
          console.log(`[AudioStreamer] SOX: ${msg}`);
        }
      });

      this._soxProcess.on('error', (err) => {
        console.error(`[AudioStreamer] SOXプロセスエラー:`, err.message);
        this._isStreaming = false;
        this.emit('streamError', { error: err.message });
        this._closeAllClients();
      });

      this._soxProcess.on('close', (code) => {
        console.log(`[AudioStreamer] SOXプロセス終了: code=${code}`);
        this._isStreaming = false;
        this._soxProcess = null;

        // 意図的な停止の場合は再起動しない
        if (this._intentionalStop) {
          return;
        }

        // 異常終了の場合、クライアントか録音がまだあれば再起動を試みる
        if (code !== 0 && (this._clients.size > 0 || this._isRecording)) {
          console.log('[AudioStreamer] SOXプロセスが異常終了。3秒後に再起動します...');
          setTimeout(() => {
            if (this._clients.size > 0 || this._isRecording) {
              this._startStreaming();
            }
          }, 3000);
        }
      });

      this.emit('streamStart');
    } catch (err) {
      console.error(`[AudioStreamer] SOXストリーミング開始失敗:`, err.message);
      this._isStreaming = false;
      this.emit('streamError', { error: err.message });
    }
  }

  /**
   * SOXストリーミング引数を構築する
   * @returns {string[]} SOXコマンド引数
   * @private
   */
  _buildSoxStreamArgs() {
    const config = this._audioConfig;
    const args = [];

    // 入力デバイス
    if (config.device && config.device !== 'default') {
      args.push('-t', 'alsa', config.device);
    } else {
      args.push('-t', 'alsa', 'default');
    }

    // 出力フォーマット: MP3をstdoutに出力
    args.push('-t', 'mp3');

    // チャンネル数
    args.push('-c', String(config.channels || 1));

    // サンプルレート
    args.push('-r', String(config.sampleRate || 22050));

    // ビットレート（MP3圧縮品質）
    // SOX MP3出力: -C はビットレート設定
    args.push('-C', String(config.mp3Bitrate || 64));

    // 出力先: stdout ( - )
    args.push('-');

    return args;
  }

  /**
   * モック用ストリーミングを開始する（有効なMP3無音フレームを定期送信）
   * @private
   */
  _startMockStreaming() {
    console.log('[AudioStreamer] モックストリーミング開始');
    this._isStreaming = true;
    this._intentionalStop = false;

    // 有効なMP3無音フレームを生成
    this._mockSilenceFrame = this._generateValidMp3SilenceFrame();

    // 約26ms間隔でフレームを送信（MP3 1フレームあたり約26ms @22050Hz）
    const frameIntervalMs = 26;
    this._mockTimer = setInterval(() => {
      if ((this._clients.size > 0 || this._isRecording) && this._mockSilenceFrame) {
        this._broadcastChunk(this._mockSilenceFrame);
      }
    }, frameIntervalMs);

    this.emit('streamStart');
  }

  /**
   * ブラウザが再生可能な有効なMP3無音フレームを生成する。
   * MPEG2 Layer3 64kbps 22050Hz Mono のフレーム。
   * フレームサイズ = 72 * 64000 / 22050 = 208.98... ≒ 209バイト
   * @returns {Buffer} 有効なMP3フレームバッファ
   * @private
   */
  _generateValidMp3SilenceFrame() {
    // MPEG2 Layer3 ヘッダー（4バイト）:
    // Byte 0: 0xFF (sync)
    // Byte 1: 0xF3 (sync + MPEG2, Layer3, no CRC protection)
    // Byte 2: 0x68 (64kbps for MPEG2 Layer3, 22050Hz, padding=0)
    // Byte 3: 0xC0 (mono, no mode extension, no copyright, original, no emphasis)
    const frameSize = 209;
    const frame = Buffer.alloc(frameSize, 0);

    // ヘッダー書き込み
    frame[0] = 0xFF;
    frame[1] = 0xF3;
    frame[2] = 0x68;
    frame[3] = 0xC0;

    // Side information (MPEG2 Layer3 mono = 9バイト)
    // main_data_begin = 0 (最初の2ビット)、残りはゼロで無音を表現
    // バイト4-12はすべて0x00のまま（無音のサイドインフォ）

    return frame;
  }

  /**
   * MP3データチャンクを全クライアントと録音パイプにブロードキャストする
   * @param {Buffer} chunk - MP3データチャンク
   * @private
   */
  _broadcastChunk(chunk) {
    // ストリーミングクライアントへの配信
    for (const client of this._clients) {
      try {
        if (!client.destroyed) {
          client.write(chunk);
        }
      } catch {
        // 書き込みエラーのクライアントは除去される（errorイベントで処理済み）
      }
    }

    // 録音パイプへの書き込み
    if (this._isRecording && this._recordingStream && !this._recordingStream.destroyed) {
      try {
        this._recordingStream.write(chunk);
      } catch {
        // 書き込みエラーは recordingStream の error イベントで処理
      }
    }
  }

  /**
   * ストリーミングを停止する（SOXプロセスの終了をPromiseで待つ）
   * @returns {Promise<void>} SOXプロセス終了のPromise
   * @private
   */
  _stopStreaming() {
    if (!this._isStreaming) {
      return Promise.resolve();
    }

    console.log('[AudioStreamer] ストリーミング停止');
    this._intentionalStop = true;

    // モックタイマー停止
    if (this._mockTimer) {
      clearInterval(this._mockTimer);
      this._mockTimer = null;
      this._isStreaming = false;
      this.emit('streamStop');
      return Promise.resolve();
    }

    // SOXプロセス停止（Promiseで終了を待つ）
    if (this._soxProcess) {
      this._stopPromise = new Promise((resolve) => {
        const proc = this._soxProcess;

        // タイムアウト: 5秒でプロセスが終了しなければ強制終了
        const timeout = setTimeout(() => {
          console.warn('[AudioStreamer] SOXプロセスがタイムアウト。SIGKILLで強制終了します。');
          try {
            proc.kill('SIGKILL');
          } catch {
            // 無視
          }
          this._isStreaming = false;
          this._soxProcess = null;
          this.emit('streamStop');
          resolve();
        }, 5000);

        // closeイベントで正常終了を検知
        proc.once('close', () => {
          clearTimeout(timeout);
          this._isStreaming = false;
          this._soxProcess = null;
          this.emit('streamStop');
          resolve();
        });

        try {
          proc.kill('SIGINT');
        } catch (err) {
          console.error(`[AudioStreamer] SOX停止エラー:`, err.message);
          clearTimeout(timeout);
          this._isStreaming = false;
          this._soxProcess = null;
          this.emit('streamStop');
          resolve();
        }
      });

      return this._stopPromise;
    }

    this._isStreaming = false;
    this.emit('streamStop');
    return Promise.resolve();
  }

  /**
   * 全クライアントの接続を閉じる
   * @private
   */
  _closeAllClients() {
    for (const client of this._clients) {
      try {
        client.end();
      } catch {
        // 無視
      }
    }
    this._clients.clear();
  }

  /**
   * リソースを解放する
   */
  async destroy() {
    this.stopRecordingPipe();
    await this._stopStreaming();
    this._closeAllClients();
    this.removeAllListeners();
  }
}

module.exports = AudioStreamer;
