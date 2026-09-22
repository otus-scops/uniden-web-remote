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
    try {
      await app.fetchApi('/scanner/scan', { method: 'POST' });
    } catch (err) {
      console.error('[ControlPanel] Scan command error:', err);
    }
  }

  /**
   * Handle Hold button click
   */
  async function onHold() {
    try {
      await app.fetchApi('/scanner/hold', { method: 'POST' });
    } catch (err) {
      console.error('[ControlPanel] Hold command error:', err);
    }
  }

  /**
   * Simulate key press action
   * @param {string} key - Key name identifier
   * @param {string} action - Key action ('P' for Press, 'H' for Hold, 'R' for Release)
   */
  async function onKey(key, action) {
    try {
      await app.fetchApi('/scanner/key', {
        method: 'POST',
        body: JSON.stringify({ key, action }),
      });
    } catch (err) {
      console.error('[ControlPanel] Key command error:', err);
    }
  }

  /**
   * Handle auto-record toggle switch change
   * @param {boolean} checked - Checkbox state
   */
  async function onToggleAutoRecord(checked) {
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
  }

  /**
   * Handle scanner hardware volume change
   * @param {number} level - 0-15
   */
  async function onVolumeChange(level) {
    try {
      await app.fetchApi('/scanner/vol', {
        method: 'POST',
        body: JSON.stringify({ level: parseInt(level, 10) })
      });
      document.getElementById('vol-level-display').textContent = level;
    } catch (err) {
      console.error('[ControlPanel] Volume change error:', err);
    }
  }

  /**
   * Handle scanner hardware squelch change
   * @param {number} level - 0-15
   */
  async function onSquelchChange(level) {
    try {
      await app.fetchApi('/scanner/sql', {
        method: 'POST',
        body: JSON.stringify({ level: parseInt(level, 10) })
      });
      document.getElementById('sql-level-display').textContent = level;
    } catch (err) {
      console.error('[ControlPanel] Squelch change error:', err);
    }
  }

  /** @type {number|null} Debounce timer ID for filename template preview */
  let previewTimeoutId = null;

  /**
   * Handle filename template input change
   * @param {string} template - New template string
   */
  async function onTemplateChange(template) {
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
    onTemplateChange,
    onTemplatePreview,
    onSendCommand,
    onCommandResponse,
    onStatusUpdate,
  };
})();
