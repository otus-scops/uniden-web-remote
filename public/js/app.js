/**
 * @fileoverview Main Application Controller
 * @description Manages WebSocket connections and global application state
 */

/**
 * Main application singleton
 * Manages WebSocket connection and global state
 */
const app = (() => {
  /** @type {WebSocket|null} WebSocket connection */
  let ws = null;

  /** @type {boolean} Connection status */
  let isConnected = false;

  /** @type {number} Reconnection interval (ms) */
  const RECONNECT_INTERVAL = 3000;

  /** @type {number|null} Reconnection timer ID */
  let reconnectTimer = null;

  /** @type {Object} Latest scanner status snapshot */
  let currentStatus = {};

  /**
   * Establish WebSocket connection
   */
  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    console.log(`[App] Connecting WebSocket: ${wsUrl}`);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[App] WebSocket connected');
      isConnected = true;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onclose = () => {
      console.log('[App] WebSocket disconnected');
      isConnected = false;
      onDisconnect();
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('[App] WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        onMessage(message);
      } catch (err) {
        console.error('[App] Message parse error:', err);
      }
    };
  }

  /**
   * Schedule reconnection attempt
   */
  function scheduleReconnect() {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      console.log('[App] Reconnecting...');
      connect();
    }, RECONNECT_INTERVAL);
  }

  /**
   * Handle incoming WebSocket message
   * @param {Object} message - Parsed message object
   */
  function onMessage(message) {
    switch (message.type) {
      case 'status':
        currentStatus = message.data;
        // Notify UI modules
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
        console.error('[App] Recording error:', message.data);
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
        // Raw serial debug data
        break;

      case 'error':
        console.error('[App] Server error:', message.data);
        break;
    }
  }

  /**
   * Handle WebSocket disconnection
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
   * Send message over WebSocket
   * @param {string} type - Message type
   * @param {Object} data - Payload
   */
  function send(type, data = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    } else {
      console.warn('[App] Cannot send message: WebSocket is not open');
    }
  }

  /**
   * Make REST API request
   * @param {string} endpoint - API endpoint path
   * @param {Object} [options={}] - Fetch options
   * @returns {Promise<Object>} JSON response
   */
  async function fetchApi(endpoint, options = {}) {
    const defaultOpts = {
      headers: { 'Content-Type': 'application/json' },
    };

    const response = await fetch(`/api${endpoint}`, { ...defaultOpts, ...options });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get current scanner status snapshot
   * @returns {Object}
   */
  function getStatus() {
    return currentStatus;
  }

  // Initialization
  document.addEventListener('DOMContentLoaded', async () => {
    // Initialize i18n localization engine
    if (typeof i18n !== 'undefined') {
      await i18n.init();
    }

    connect();

    // Global listener for language changes
    window.addEventListener('languageChanged', () => {
      // Update connection status label
      const statusText = document.getElementById('connection-text');
      if (statusText) {
        statusText.innerText = isConnected
          ? i18n.t('header.connected')
          : i18n.t('header.disconnected');
      }
      // Update memory editor button label
      const btnEditor = document.getElementById('btn-toggle-editor');
      if (btnEditor) {
        const isEditorOpen = !document.getElementById('editor-view').classList.contains('hidden');
        btnEditor.innerText = isEditorOpen
          ? i18n.t('header.returnToScanner')
          : i18n.t('header.editorBtn');
      }
    });

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    }

    // PWA Install prompt handling
    let deferredPrompt = null;
    const installBtn = document.getElementById('pwa-install-btn');

    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent default mini-infobar
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) {
        installBtn.style.display = 'inline-flex';
      }
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        installBtn.style.display = 'none';
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[PWA] Install prompt outcome:', outcome);
        deferredPrompt = null;
      });
    }

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] Application installed');
      if (installBtn) {
        installBtn.style.display = 'none';
      }
      deferredPrompt = null;
    });

    // Initial fetch of recording file list
    setTimeout(() => {
      if (typeof recordingPanel !== 'undefined') {
        recordingPanel.onRefresh();
      }
    }, 1000);
  });

  // Public API
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
