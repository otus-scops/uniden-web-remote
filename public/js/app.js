/**
 * @fileoverview メインアプリケーション
 * @description WebSocket接続管理とグローバル状態管理を行う
 */

/**
 * アプリケーションメインクラス
 * WebSocket接続とグローバル状態を管理する
 */
const app = (() => {
  /** @type {WebSocket|null} WebSocket接続 */
  let ws = null;

  /** @type {boolean} 接続状態 */
  let isConnected = false;

  /** @type {number} 再接続間隔(ms) */
  const RECONNECT_INTERVAL = 3000;

  /** @type {number|null} 再接続タイマー */
  let reconnectTimer = null;

  /** @type {Object} 最新のスキャナーステータス */
  let currentStatus = {};

  /**
   * WebSocket接続を確立する
   */
  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    console.log(`[App] WebSocket接続: ${wsUrl}`);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[App] WebSocket接続完了');
      isConnected = true;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onclose = () => {
      console.log('[App] WebSocket切断');
      isConnected = false;
      onDisconnect();
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('[App] WebSocketエラー:', err);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        onMessage(message);
      } catch (err) {
        console.error('[App] メッセージパースエラー:', err);
      }
    };
  }

  /**
   * 再接続をスケジュールする
   */
  function scheduleReconnect() {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      console.log('[App] 再接続中...');
      connect();
    }, RECONNECT_INTERVAL);
  }

  /**
   * WebSocketメッセージを処理する
   * @param {Object} message - パース済みメッセージ
   */
  function onMessage(message) {
    switch (message.type) {
      case 'status':
        currentStatus = message.data;
        // 各UIモジュールに通知
        if (typeof scannerDisplay !== 'undefined') {
          scannerDisplay.onStatusUpdate(message.data);
        }
        if (typeof controlPanel !== 'undefined') {
          controlPanel.onStatusUpdate(message.data);
        }
        break;

      case 'receptionStart':
        if (typeof scannerDisplay !== 'undefined') {
          scannerDisplay.onReceptionStart(message.data);
        }
        if (typeof activityLog !== 'undefined') {
          activityLog.onReceptionStart(message.data);
        }
        break;

      case 'receptionEnd':
        if (typeof scannerDisplay !== 'undefined') {
          scannerDisplay.onReceptionEnd(message.data);
        }
        if (typeof activityLog !== 'undefined') {
          activityLog.onReceptionEnd(message.data);
        }
        break;

      case 'recordingStart':
        if (typeof recordingPanel !== 'undefined') {
          recordingPanel.onRecordingStart(message.data);
        }
        break;

      case 'recordingStop':
        if (typeof recordingPanel !== 'undefined') {
          recordingPanel.onRecordingStop(message.data);
        }
        break;

      case 'recordingError':
        console.error('[App] 録音エラー:', message.data);
        break;

      case 'commandResponse':
        if (typeof controlPanel !== 'undefined') {
          controlPanel.onCommandResponse(message.data);
        }
        break;

      case 'log':
        if (typeof activityLog !== 'undefined') {
          activityLog.onLogData(message.data);
        }
        break;

      case 'serialData':
        // デバッグ用 -nip 応じて処理
        break;

      case 'error':
        console.error('[App] サーバーエラー:', message.data);
        break;
    }
  }

  /**
   * WebSocket切断時の処理
   */
  function onDisconnect() {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('connection-text');
    if (statusDot) statusDot.classList.remove('connected');
    if (statusText) statusText.innerText = typeof i18n !== 'undefined' ? i18n.t('header.disconnected') : '切断中';

    if (typeof scannerDisplay !== 'undefined') {
      scannerDisplay.onStatusUpdate({
        isConnected: false,
        isReceiving: false,
        isRecording: false,
      });
    }
  }

  /**
   * WebSocket経由でメッセージを送信する
   * @param {string} type - メッセージタイプ
   * @param {Object} data - ペイロード
   */
  function send(type, data = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    } else {
      console.warn('[App] WebSocket未接続のためメッセージを送信できません');
    }
  }

  /**
   * REST API呼び出しを行う
   * @param {string} endpoint - APIエンドポイント
   * @param {Object} [options={}] - fetchオプション
   * @returns {Promise<Object>} レスポンスJSON
   */
  async function fetchApi(endpoint, options = {}) {
    const defaultOpts = {
      headers: { 'Content-Type': 'application/json' },
    };

    const response = await fetch(`/api${endpoint}`, { ...defaultOpts, ...options });

    if (!response.ok) {
      throw new Error(`API エラー: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * 現在のステータスを取得する
   * @returns {Object}
   */
  function getStatus() {
    return currentStatus;
  }

  // 初期化
  document.addEventListener('DOMContentLoaded', async () => {
    // i18n 多言語化エンジンの初期化
    if (typeof i18n !== 'undefined') {
      await i18n.init();
    }

    connect();

    // 言語切り替え時のグローバルイベント
    window.addEventListener('languageChanged', () => {
      // 接続ステータス表記更新
      const statusText = document.getElementById('connection-text');
      if (statusText) {
        statusText.innerText = isConnected
          ? i18n.t('header.connected')
          : i18n.t('header.disconnected');
      }
      // エディタボタン更新
      const btnEditor = document.getElementById('btn-toggle-editor');
      if (btnEditor) {
        const isEditorOpen = !document.getElementById('editor-view').classList.contains('hidden');
        btnEditor.innerText = isEditorOpen
          ? i18n.t('header.returnToScanner')
          : i18n.t('header.editorBtn');
      }
    });

    // 録音ファイルリストの初期読み込み
    setTimeout(() => {
      if (typeof recordingPanel !== 'undefined') {
        recordingPanel.onRefresh();
      }
    }, 1000);
  });

  // 公開API
  return {
    connect,
    send,
    fetchApi,
    getStatus,
    toggleEditorMode: () => {
      if (typeof memoryEditor !== 'undefined') memoryEditor.toggleMode();
    },
    get isConnected() { return isConnected; },
  };
})();
