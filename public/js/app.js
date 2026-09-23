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

  /** @type {string} Stored authentication token */
  let authToken = localStorage.getItem('bct15x_auth_token') || '';

  /** @type {boolean} Auth requirement enabled */
  let authEnabled = false;

  /** @type {'operator'|'listener'|'public'} Current authenticated role */
  let currentUserRole = 'public';

  /**
   * Check authentication status from server
   */
  async function checkAuthStatus() {
    try {
      const data = await fetchApi('/auth/status');
      authEnabled = !!data.enabled;
      currentUserRole = data.role || 'public';
      updateAuthUI();
    } catch {
      // Ignore if auth status endpoint fails
    }
  }

  /**
   * Authenticate with password
   * @param {string} password
   */
  async function login(password) {
    const errorMsg = document.getElementById('auth-error-msg');
    if (errorMsg) errorMsg.style.display = 'none';

    try {
      const data = await fetchApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });

      if (data.token) {
        authToken = data.token;
        localStorage.setItem('bct15x_auth_token', authToken);
        currentUserRole = data.role;
        updateAuthUI();
        onCloseAuthModal();
      }
    } catch (err) {
      if (errorMsg) {
        errorMsg.style.display = 'block';
        errorMsg.innerText = typeof i18n !== 'undefined'
          ? i18n.t('auth.loginFailed')
          : 'パスワードが正しくありません';
      }
    }
  }

  /**
   * Log out of current session
   */
  async function logout() {
    try {
      await fetchApi('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    authToken = '';
    localStorage.removeItem('bct15x_auth_token');
    currentUserRole = 'public';
    updateAuthUI();
  }

  /**
   * Update header authentication badge and button
   */
  function updateAuthUI() {
    const badge = document.getElementById('auth-role-badge');
    const btn = document.getElementById('btn-auth-toggle');

    if (!badge || !btn) return;

    if (!authEnabled) {
      badge.style.display = 'none';
      btn.style.display = 'none';
      return;
    }

    badge.style.display = 'inline-flex';
    btn.style.display = 'inline-flex';

    badge.className = `auth-badge ${currentUserRole}`;

    const roleLabels = {
      operator: typeof i18n !== 'undefined' ? i18n.t('auth.operator') : '👑 オペレーター',
      listener: typeof i18n !== 'undefined' ? i18n.t('auth.listener') : '🎧 リスナー',
      public: typeof i18n !== 'undefined' ? i18n.t('auth.public') : '🌐 ゲスト',
    };

    badge.innerText = roleLabels[currentUserRole] || roleLabels.public;

    if (currentUserRole !== 'public') {
      btn.innerText = typeof i18n !== 'undefined' ? i18n.t('auth.logout') : 'ログアウト';
    } else {
      btn.innerText = typeof i18n !== 'undefined' ? i18n.t('auth.login') : 'ログイン';
    }
  }

  /**
   * Handle authentication button click in header
   */
  function onAuthBtnClick() {
    if (currentUserRole !== 'public') {
      const confirmMsg = typeof i18n !== 'undefined' ? i18n.t('auth.logout') : 'ログアウトしますか？';
      if (confirm(confirmMsg + '?')) {
        logout();
      }
    } else {
      onOpenAuthModal();
    }
  }

  /**
   * Open login modal
   * @param {string} [hint]
   */
  function onOpenAuthModal(hint) {
    const modal = document.getElementById('auth-modal');
    const pwdInput = document.getElementById('auth-password');
    const errorMsg = document.getElementById('auth-error-msg');

    if (errorMsg) {
      if (hint) {
        errorMsg.innerText = hint;
        errorMsg.style.display = 'block';
      } else {
        errorMsg.style.display = 'none';
      }
    }

    if (pwdInput) pwdInput.value = '';
    if (modal) modal.classList.remove('hidden');
    if (pwdInput) setTimeout(() => pwdInput.focus(), 100);
  }

  /**
   * Close login modal
   */
  function onCloseAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');
  }

  /**
   * Handle login form submission
   */
  function onAuthSubmit() {
    const pwdInput = document.getElementById('auth-password');
    if (pwdInput && pwdInput.value) {
      login(pwdInput.value);
    }
  }

  /**
   * Check if current user has operator permissions
   * @returns {boolean}
   */
  function isOperator() {
    return !authEnabled || currentUserRole === 'operator';
  }

  /**
   * Guard an operator action
   * @param {Function} action - Callback to run if operator
   */
  function requireOperator(action) {
    if (isOperator()) {
      return action();
    }
    const hint = typeof i18n !== 'undefined'
      ? i18n.t('auth.operatorRequired')
      : 'この操作にはオペレーター権限が必要です。ログインしてください。';
    onOpenAuthModal(hint);
  }

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

      case 'logEntryUpdated':
        if (typeof activityLog !== 'undefined') {
          activityLog.onLogEntryUpdated(message.data);
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
      const payload = { type, ...data };
      if (authToken) {
        payload.token = authToken;
      }
      ws.send(JSON.stringify(payload));
    } else {
      console.warn('[App] Cannot send message: WebSocket is not open');
    }
  }

  /**
   * Make REST API request with authorization header
   * @param {string} endpoint - API endpoint path
   * @param {Object} [options={}] - Fetch options
   * @returns {Promise<Object>} JSON response
   */
  async function fetchApi(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`/api${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && authEnabled) {
      // Clear expired or invalid token
      authToken = '';
      localStorage.removeItem('bct15x_auth_token');
      currentUserRole = 'public';
      updateAuthUI();
      onOpenAuthModal();
      throw new Error('Unauthorized');
    }

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

    // Check system auth requirements and role
    await checkAuthStatus();

    connect();

    // Global listener for language changes
    window.addEventListener('languageChanged', () => {
      updateAuthUI();
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
    onAuthBtnClick,
    onOpenAuthModal,
    onCloseAuthModal,
    onAuthSubmit,
    isOperator,
    requireOperator,
    get userRole() { return currentUserRole; },
    toggleEditorMode: () => {
      if (typeof memoryEditor !== 'undefined') memoryEditor.toggleMode();
    },
    get isConnected() { return isConnected; },
  };
})();
