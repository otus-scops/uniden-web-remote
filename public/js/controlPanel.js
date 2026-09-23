/**
 * @fileoverview Control Panel Module
 * @description Manages scan control, keypad simulation, recording settings, and command console UI
 */

/**
 * Control Panel UI controller
 */
const controlPanel = (() => {
  /**
   * Handle Scan button click
   */
  async function onScan() {
    app.requireOperator(async () => {
      try {
        await app.fetchApi('/scanner/scan', { method: 'POST' });
      } catch (err) {
        console.error('[ControlPanel] Scan command error:', err);
      }
    });
  }

  /**
   * Handle Hold button click
   */
  async function onHold() {
    app.requireOperator(async () => {
      try {
        await app.fetchApi('/scanner/hold', { method: 'POST' });
      } catch (err) {
        console.error('[ControlPanel] Hold command error:', err);
      }
    });
  }

  /**
   * Simulate key press action
   * @param {string} key - Key name identifier
   * @param {string} action - Key action ('P' for Press, 'H' for Hold, 'R' for Release)
   */
  async function onKey(key, action) {
    app.requireOperator(async () => {
      try {
        await app.fetchApi('/scanner/key', {
          method: 'POST',
          body: JSON.stringify({ key, action }),
        });
      } catch (err) {
        console.error('[ControlPanel] Key command error:', err);
      }
    });
  }

  /**
   * Handle auto-record toggle switch change
   * @param {boolean} checked - Checkbox state
   */
  async function onToggleAutoRecord(checked) {
    app.requireOperator(async () => {
      try {
        await app.fetchApi('/config', {
          method: 'PUT',
          body: JSON.stringify({
            audio: { autoRecord: checked },
          }),
        });
      } catch (err) {
        console.error('[ControlPanel] Config update error:', err);
      }
    });
  }

  /**
   * Handle maximum reception duration select change
   * @param {string|number} sec - Duration in seconds (0 = disabled)
   */
  async function onMaxReceptionDurationChange(sec) {
    app.requireOperator(async () => {
      try {
        const duration = parseInt(sec, 10) || 0;
        await app.fetchApi('/config', {
          method: 'PUT',
          body: JSON.stringify({
            scanner: { maxReceptionDurationSec: duration },
          }),
        });
        console.log(`[ControlPanel] Updated max reception duration: ${duration}s`);
      } catch (err) {
        console.error('[ControlPanel] Failed to update max reception duration:', err);
      }
    });
  }

  /**
   * Handle scanner hardware volume change
   * @param {number} level - 0-15
   */
  async function onVolumeChange(level) {
    app.requireOperator(async () => {
      try {
        await app.fetchApi('/scanner/vol', {
          method: 'POST',
          body: JSON.stringify({ level: parseInt(level, 10) })
        });
        document.getElementById('vol-level-display').textContent = level;
      } catch (err) {
        console.error('[ControlPanel] Volume change error:', err);
      }
    });
  }

  /**
   * Handle scanner hardware squelch change
   * @param {number} level - 0-15
   */
  async function onSquelchChange(level) {
    app.requireOperator(async () => {
      try {
        await app.fetchApi('/scanner/sql', {
          method: 'POST',
          body: JSON.stringify({ level: parseInt(level, 10) })
        });
        document.getElementById('sql-level-display').textContent = level;
      } catch (err) {
        console.error('[ControlPanel] Squelch change error:', err);
      }
    });
  }

  /** @type {number|null} Debounce timer ID for filename template preview */
  let previewTimeoutId = null;

  /**
   * Handle filename template input change
   * @param {string} template - New template string
   */
  async function onTemplateChange(template) {
    app.requireOperator(async () => {
      try {
        await app.fetchApi('/config', {
          method: 'PUT',
          body: JSON.stringify({
            fileNaming: { template },
          }),
        });
      } catch (err) {
        console.error('[ControlPanel] Template update error:', err);
      }
    });
  }

  /**
   * Update filename template preview with debouncing
   * @param {string} template - Template pattern string
   */
  function onTemplatePreview(template) {
    if (previewTimeoutId) {
      clearTimeout(previewTimeoutId);
    }
    
    const previewEl = document.getElementById('template-preview-text');
    if (!template.trim()) {
      previewEl.textContent = '---';
      return;
    }
    
    previewTimeoutId = setTimeout(async () => {
      try {
        const res = await app.fetchApi('/config/template-preview', {
          method: 'POST',
          body: JSON.stringify({ template })
        });
        
        if (res.preview) {
          previewEl.textContent = res.preview;
        }
      } catch (err) {
        const errPrefix = typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Error: ' : 'エラー: ';
        previewEl.textContent = errPrefix + err.message;
      }
    }, 300);
  }

  /**
   * Send custom raw serial command
   */
  async function onSendCommand() {
    app.requireOperator(async () => {
      const input = document.getElementById('command-input');
      const output = document.getElementById('command-output');
      const command = input.value.trim();

      if (!command) return;

      const sendingMsg = typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Sending...' : '送信中...';
      output.textContent = `> ${command}\n${sendingMsg}`;

    try {
      const result = await app.fetchApi('/scanner/command', {
        method: 'POST',
        body: JSON.stringify({ command }),
      });

      output.textContent = `> ${command}\n< ${result.response}`;
      output.scrollTop = output.scrollHeight;
    } catch (err) {
      const errPrefix = typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Error: ' : 'エラー: ';
      output.textContent = `> ${command}\n${errPrefix}${err.message}`;
    }

    input.value = '';
    input.focus();
    });
  }

  /**
   * Handle incoming command response from WebSocket
   * @param {Object} data - Response payload
   */
  function onCommandResponse(data) {
    const output = document.getElementById('command-output');
    const cmd = data.command || data.key || '???';
    const prev = output.textContent;
    output.textContent = `${prev}\n> ${cmd}\n< ${data.response}`;
    output.scrollTop = output.scrollHeight;
  }

  /**
   * Handle status updates from WebSocket
   * @param {Object} status - Scanner status
   */
  function onStatusUpdate(status) {
    // Synchronize auto-record toggle switch
    const toggle = document.querySelector('#toggle-auto-record input');
    if (toggle && status.autoRecordEnabled !== undefined) {
      toggle.checked = status.autoRecordEnabled;
    }

    // Synchronize max reception duration select
    if (status.maxReceptionDurationSec !== undefined) {
      const select = document.getElementById('select-max-reception');
      if (select && document.activeElement !== select) {
        select.value = String(status.maxReceptionDurationSec);
      }
    }
  }

  /**
   * Load and synchronize system configuration from server
   */
  async function loadConfig() {
    try {
      const data = await app.fetchApi('/config');
      if (data && data.fileNaming && data.fileNaming.template) {
        const input = document.getElementById('filename-template');
        if (input) {
          input.value = data.fileNaming.template;
          onTemplatePreview(data.fileNaming.template);
        }
      }
      if (data && data.audio && data.audio.autoRecord !== undefined) {
        const toggle = document.querySelector('#toggle-auto-record input');
        if (toggle) {
          toggle.checked = data.audio.autoRecord;
        }
      }
      if (data && data.scanner && data.scanner.maxReceptionDurationSec !== undefined) {
        const select = document.getElementById('select-max-reception');
        if (select) {
          select.value = String(data.scanner.maxReceptionDurationSec);
        }
      }
    } catch (err) {
      console.warn('[ControlPanel] Failed to load initial configuration:', err.message);
    }
  }

  /**
   * Initialize keyboard shortcuts for virtual LCD and scanner remote control
   */
  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (event) => {
      // Ignore if user is currently typing in an input, textarea, select, or contenteditable element
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable
      )) {
        return;
      }

      // Check if modal dialogs are open
      const authModal = document.getElementById('auth-modal');
      if (authModal && !authModal.classList.contains('hidden') && authModal.style.display !== 'none' && authModal.style.display !== '') {
        return;
      }

      let handled = false;
      switch (event.key) {
        case 'ArrowUp':
          onKey('^', 'P');
          handled = true;
          break;
        case 'ArrowDown':
          onKey('V', 'P');
          handled = true;
          break;
        case 'ArrowLeft':
          onKey('<', 'P');
          handled = true;
          break;
        case 'ArrowRight':
          onKey('>', 'P');
          handled = true;
          break;
        case 'Enter':
          onKey('E', 'P');
          handled = true;
          break;
        case 'Escape':
          onKey('M', 'P');
          handled = true;
          break;
        case 'm':
        case 'M':
          onKey('M', 'P');
          handled = true;
          break;
        case 'f':
        case 'F':
          onKey('F', 'P');
          handled = true;
          break;
      }

      if (handled) {
        event.preventDefault();
      }
    });
  }

  // Load configuration and setup keyboard shortcuts on page initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadConfig();
      setupKeyboardShortcuts();
    });
  } else {
    loadConfig();
    setupKeyboardShortcuts();
  }

  // Synchronize waiting text on language change
  window.addEventListener('languageChanged', () => {
    const output = document.getElementById('command-output');
    if (output && (output.textContent === '待機中...' || output.textContent === 'Waiting...')) {
      output.textContent = typeof i18n !== 'undefined' ? i18n.t('control.waiting') : '待機中...';
    }
  });

  // Public API
  return {
    onScan,
    onHold,
    onKey,
    onVolumeChange,
    onSquelchChange,
    onToggleAutoRecord,
    onMaxReceptionDurationChange,
    onTemplateChange,
    onTemplatePreview,
    onSendCommand,
    onCommandResponse,
    onStatusUpdate,
    loadConfig,
  };
})();
