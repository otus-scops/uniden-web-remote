/**
 * @fileoverview 操作パネルモジュール
 * @description スキャン制御、キーシミュレーション、録音設定、コマンドコンソールのUIを管理する
 */

/**
 * 操作パネルUI管理
 */
const controlPanel = (() => {
  /**
   * スキャンボタン押下時の処理
   */
  async function onScan() {
    try {
      await app.fetchApi('/scanner/scan', { method: 'POST' });
    } catch (err) {
      console.error('[ControlPanel] スキャンコマンドエラー:', err);
    }
  }

  /**
   * ホールドボタン押下時の処理
   */
  async function onHold() {
    try {
      await app.fetchApi('/scanner/hold', { method: 'POST' });
    } catch (err) {
      console.error('[ControlPanel] ホールドコマンドエラー:', err);
    }
  }

  /**
   * キープレスシミュレーション
   * @param {string} key - キー名
   * @param {string} action - アクション（P/H/R）
   */
  async function onKey(key, action) {
    try {
      await app.fetchApi('/scanner/key', {
        method: 'POST',
        body: JSON.stringify({ key, action }),
      });
    } catch (err) {
      console.error('[ControlPanel] キーコマンドエラー:', err);
    }
  }

  /**
   * 自動録音トグルの変更処理
   * @param {boolean} checked - チェック状態
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
      console.error('[ControlPanel] 設定更新エラー:', err);
    }
  }

  /**
   * スキャナー音量の変更処理
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
      console.error('[ControlPanel] 音量変更エラー:', err);
    }
  }

  /**
   * スキャナースケルチの変更処理
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
      console.error('[ControlPanel] スケルチ変更エラー:', err);
    }
  }

  /** @type {number} プレビュー用デバウンスタイマーID */
  let previewTimeoutId = null;

  /**
   * ファイル名テンプレート変更処理
   * @param {string} template - 新しいテンプレート文字列
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
      console.error('[ControlPanel] テンプレート更新エラー:', err);
    }
  }

  /**
   * テンプレートプレビューの更新
   * @param {string} template - テンプレート文字列
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
   * コマンド送信処理
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
   * コマンドレスポンス受信処理
   * @param {Object} data - レスポンスデータ
   */
  function onCommandResponse(data) {
    const output = document.getElementById('command-output');
    const cmd = data.command || data.key || '???';
    const prev = output.textContent;
    output.textContent = `${prev}\n> ${cmd}\n< ${data.response}`;
    output.scrollTop = output.scrollHeight;
  }

  /**
   * ステータス更新時の処理
   * @param {Object} status - スキャナーステータス
   */
  function onStatusUpdate(status) {
    // 自動録音トグルの同期
    const toggle = document.querySelector('#toggle-auto-record input');
    if (toggle && status.autoRecordEnabled !== undefined) {
      toggle.checked = status.autoRecordEnabled;
    }
  }

  // 言語切り替え時に待機中テキスト等を同期
  window.addEventListener('languageChanged', () => {
    const output = document.getElementById('command-output');
    if (output && (output.textContent === '待機中...' || output.textContent === 'Waiting...')) {
      output.textContent = typeof i18n !== 'undefined' ? i18n.t('control.waiting') : '待機中...';
    }
  });

  // 公開API
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
