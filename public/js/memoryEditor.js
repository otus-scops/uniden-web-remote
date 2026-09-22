/**
 * @fileoverview FreeSCAN代替 本格メモリエディタ フロントエンドロジック (Vanilla JS)
 * @description システム・グループ階層ツリーナビゲーション、スプレッドシート型チャンネル一覧編集、
 * Excel/TSV一括貼り付け、実機DMA同期、自動バックアップ復元、JSON/CSV入出力
 */

const memoryEditor = (function () {
  /** @type {Array<Object>} メモリ構造データ (システム配列) */
  let memorySystems = [];

  /** @type {number|string|null} 現在選択中のシステムID */
  let selectedSystemId = null;

  /** @type {number|string|null} 現在選択中のグループID */
  let selectedGroupId = null;

  /** @type {boolean} エディタモード中フラグ */
  let isEditorMode = false;

  /** @type {number|null} 進捗ポーリング用タイマー */
  let progressPollTimer = null;

  /**
   * 多言語翻訳ヘルパー
   * @param {string} key
   * @param {Object} [params]
   * @param {string} [fallback]
   * @returns {string}
   */
  function t(key, params = {}, fallback = '') {
    if (typeof i18n !== 'undefined') {
      const res = i18n.t(key, params);
      if (res !== key) return res;
    }
    if (params && typeof params === 'object') {
      return fallback.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
    }
    return fallback || key;
  }

  /**
   * 主要なCTCSS/DCSトーンリスト（セレクトボックス用）
   */
  const COMMON_TONES = [
    'None / All',
    'Search',
    // 代表的なCTCSSトーン
    'CTCSS 67.0Hz',
    'CTCSS 71.9Hz',
    'CTCSS 77.0Hz',
    'CTCSS 82.5Hz',
    'CTCSS 88.5Hz',
    'CTCSS 94.8Hz',
    'CTCSS 100.0Hz',
    'CTCSS 103.5Hz',
    'CTCSS 107.2Hz',
    'CTCSS 110.9Hz',
    'CTCSS 114.8Hz',
    'CTCSS 118.8Hz',
    'CTCSS 123.0Hz',
    'CTCSS 127.3Hz',
    'CTCSS 131.8Hz',
    'CTCSS 136.5Hz',
    'CTCSS 141.3Hz',
    'CTCSS 146.2Hz',
    'CTCSS 151.4Hz',
    'CTCSS 156.7Hz',
    'CTCSS 162.2Hz',
    'CTCSS 167.9Hz',
    'CTCSS 173.8Hz',
    'CTCSS 179.9Hz',
    'CTCSS 186.2Hz',
    'CTCSS 192.8Hz',
    'CTCSS 203.5Hz',
    'CTCSS 210.7Hz',
    'CTCSS 218.1Hz',
    'CTCSS 225.7Hz',
    'CTCSS 233.6Hz',
    'CTCSS 241.8Hz',
    'CTCSS 250.3Hz',
    'CTCSS 254.1Hz',
    // 代表的なDCSコード
    'DCS 023',
    'DCS 025',
    'DCS 026',
    'DCS 031',
    'DCS 032',
    'DCS 043',
    'DCS 047',
    'DCS 051',
    'DCS 054',
    'DCS 065',
    'DCS 071',
    'DCS 072',
    'DCS 073',
    'DCS 074',
    'DCS 114',
    'DCS 115',
    'DCS 125',
    'DCS 131',
    'DCS 132',
    'DCS 143',
    'DCS 152',
    'DCS 155',
    'DCS 162',
    'DCS 165',
    'DCS 172',
    'DCS 174',
    'DCS 205',
    'DCS 223',
    'DCS 243',
    'DCS 244',
    'DCS 245',
    'DCS 251',
    'DCS 261',
    'DCS 263',
    'DCS 265',
    'DCS 311',
    'DCS 315',
    'DCS 331',
    'DCS 343',
    'DCS 411',
    'DCS 412',
    'DCS 413',
    'DCS 431',
    'DCS 445',
    'DCS 464',
    'DCS 465',
    'DCS 503',
    'DCS 506',
    'DCS 516',
    'DCS 606',
    'DCS 612',
    'DCS 624',
    'DCS 631',
    'DCS 654',
    'DCS 703',
    'DCS 712',
    'DCS 723',
    'DCS 731',
    'DCS 732',
    'DCS 734',
    'DCS 743',
    'DCS 754',
  ];

  /**
   * 現在選択中のグループオブジェクトを取得
   * @returns {Object|null}
   */
  function getCurrentGroup() {
    if (!selectedSystemId || !selectedGroupId) return null;
    const sys = memorySystems.find((s) => String(s.id) === String(selectedSystemId));
    if (!sys || !Array.isArray(sys.groups)) return null;
    return sys.groups.find((g) => String(g.id) === String(selectedGroupId)) || null;
  }

  /**
   * 現在選択中のシステムオブジェクトを取得
   * @returns {Object|null}
   */
  function getCurrentSystem() {
    if (!selectedSystemId) return null;
    return memorySystems.find((s) => String(s.id) === String(selectedSystemId)) || null;
  }

  /**
   * 統計情報（システム数、グループ数、チャンネル数）を更新表示する
   */
  function updateStats() {
    let sysCount = memorySystems.length;
    let grpCount = 0;
    let chnCount = 0;

    for (const sys of memorySystems) {
      if (Array.isArray(sys.groups)) {
        grpCount += sys.groups.length;
        for (const grp of sys.groups) {
          if (Array.isArray(grp.channels)) {
            chnCount += grp.channels.length;
          }
        }
      }
    }

    const statsEl = document.getElementById('editor-stats');
    if (statsEl) {
      statsEl.innerText = t('editor.toolbar.stats', { sys: sysCount, grp: grpCount, chn: chnCount }, `システム: ${sysCount} | グループ: ${grpCount} | チャンネル: ${chnCount}`);
    }
  }

  /**
   * 左ペインの階層ツリービューを描画する
   */
  function renderTree() {
    const root = document.getElementById('memory-tree');
    if (!root) return;

    if (memorySystems.length === 0) {
      const emptyText = t('editor.tree.empty', {}, 'システムがありません。<br>「📥 スキャナーから読込」または「➕ システム」を押してください。');
      root.innerHTML = `
        <li class="tree-item" style="padding: 16px 8px; text-align: center; color: var(--color-text-dim);">
          ${emptyText}
        </li>
      `;
      return;
    }

    root.innerHTML = '';

    for (const sys of memorySystems) {
      const sysLi = document.createElement('li');
      sysLi.className = 'tree-item';

      const isSysSelected = String(sys.id) === String(selectedSystemId) && !selectedGroupId;

      const sysRow = document.createElement('div');
      sysRow.className = `tree-row ${isSysSelected ? 'selected' : ''}`;
      sysRow.onclick = (e) => {
        e.stopPropagation();
        selectSystem(sys.id);
      };

      const qkBadge =
        sys.quickKey !== null && sys.quickKey !== undefined
          ? `<span class="tree-badge qk" title="Quick Key">Q:${sys.quickKey}</span>`
          : '';
      const typeBadge = `<span class="tree-badge">${sys.type || 'CNV'}</span>`;

      sysRow.innerHTML = `
        <div class="tree-label-wrap">
          <span>📁</span>
          <strong>${escapeHtml(sys.name || 'Untitled')}</strong>
          ${typeBadge}
          ${qkBadge}
        </div>
        <div class="tree-actions">
          <button class="btn-icon-xs" title="${t('editor.tree.addGroupTitle', {}, 'グループ追加')}" onclick="event.stopPropagation(); memoryEditor.onAddNewGroup(${sys.id})">➕</button>
          <button class="btn-icon-xs" title="${t('editor.tree.editSystemTitle', {}, 'システム編集')}" onclick="event.stopPropagation(); memoryEditor.onEditSystem(${sys.id})">✏️</button>
          <button class="btn-icon-xs" title="${t('editor.tree.deleteSystemTitle', {}, 'システム削除')}" onclick="event.stopPropagation(); memoryEditor.onDeleteSystem(${sys.id})">🗑️</button>
        </div>
      `;

      sysLi.appendChild(sysRow);

      // グループサブツリー
      if (Array.isArray(sys.groups) && sys.groups.length > 0) {
        const grpUl = document.createElement('ul');
        grpUl.className = 'tree-children';

        for (const grp of sys.groups) {
          const grpLi = document.createElement('li');
          grpLi.className = 'tree-item';

          const isGrpSelected =
            String(sys.id) === String(selectedSystemId) && String(grp.id) === String(selectedGroupId);

          const grpRow = document.createElement('div');
          grpRow.className = `tree-row ${isGrpSelected ? 'selected' : ''}`;
          grpRow.onclick = (e) => {
            e.stopPropagation();
            selectGroup(sys.id, grp.id);
          };

          const grpQkBadge =
            grp.quickKey !== null && grp.quickKey !== undefined
              ? `<span class="tree-badge qk">Q:${grp.quickKey}</span>`
              : '';
          const chnCount = (grp.channels || []).length;
          const chnBadge = `<span class="tree-badge">${chnCount}ch</span>`;

          grpRow.innerHTML = `
            <div class="tree-label-wrap">
              <span>📂</span>
              <span>${escapeHtml(grp.name || 'Untitled')}</span>
              ${chnBadge}
              ${grpQkBadge}
            </div>
            <div class="tree-actions">
              <button class="btn-icon-xs" title="${t('editor.tree.editGroupTitle', {}, 'グループ編集')}" onclick="event.stopPropagation(); memoryEditor.onEditGroup(${sys.id}, ${grp.id})">✏️</button>
              <button class="btn-icon-xs" title="${t('editor.tree.deleteGroupTitle', {}, 'グループ削除')}" onclick="event.stopPropagation(); memoryEditor.onDeleteGroup(${sys.id}, ${grp.id})">🗑️</button>
            </div>
          `;

          grpLi.appendChild(grpRow);
          grpUl.appendChild(grpLi);
        }

        sysLi.appendChild(grpUl);
      }

      root.appendChild(sysLi);
    }
  }

  /**
   * システムを選択する
   * @param {number|string} sysId
   */
  function selectSystem(sysId) {
    selectedSystemId = sysId;
    selectedGroupId = null;
    renderTree();

    const sys = getCurrentSystem();
    const titleEl = document.getElementById('grid-current-path');
    const infoEl = document.getElementById('grid-current-info');
    const actionsEl = document.getElementById('grid-header-actions');
    const footerEl = document.getElementById('grid-footer-bar');
    const tbody = document.getElementById('channel-tbody');
    const emptyMsg = document.getElementById('grid-empty-message');

    if (titleEl) titleEl.innerText = `📁 ${sys ? sys.name : t('scanner.system', {}, 'システム')}`;
    if (infoEl) infoEl.innerText = t('editor.grid.selectGroupNotice', {}, 'グループを選択するとチャンネルを編集できます。');
    if (actionsEl) actionsEl.style.display = 'none';
    if (footerEl) footerEl.style.display = 'none';
    if (tbody) tbody.innerHTML = '';
    if (emptyMsg) {
      emptyMsg.style.display = 'block';
      emptyMsg.innerText = t('editor.grid.selectGroupPrompt', {}, '左のツリーからグループを選択してください。');
    }
  }

  /**
   * グループを選択し、そのチャンネル一覧スプレッドシートを描画する
   * @param {number|string} sysId
   * @param {number|string} grpId
   */
  function selectGroup(sysId, grpId) {
    selectedSystemId = sysId;
    selectedGroupId = grpId;
    renderTree();
    renderChannelTable();
  }

  /**
   * 選択中グループのチャンネル一覧スプレッドシートを描画する
   */
  function renderChannelTable() {
    const sys = getCurrentSystem();
    const grp = getCurrentGroup();
    const titleEl = document.getElementById('grid-current-path');
    const infoEl = document.getElementById('grid-current-info');
    const actionsEl = document.getElementById('grid-header-actions');
    const footerEl = document.getElementById('grid-footer-bar');
    const tbody = document.getElementById('channel-tbody');
    const emptyMsg = document.getElementById('grid-empty-message');
    const countEl = document.getElementById('channel-count-display');

    if (!grp) return;

    if (titleEl) titleEl.innerText = `📂 ${sys ? sys.name : ''} > ${grp.name}`;
    const chnCount = (grp.channels || []).length;
    if (infoEl) {
      infoEl.innerText = t('editor.grid.channelCount', { count: chnCount }, `チャンネル数: ${chnCount}件`);
    }
    if (actionsEl) actionsEl.style.display = 'flex';
    if (footerEl) footerEl.style.display = 'flex';

    if (!Array.isArray(grp.channels)) {
      grp.channels = [];
    }

    if (countEl) {
      countEl.innerText = t('editor.tree.groupChannelCount', { count: grp.channels.length }, `${grp.channels.length} チャンネル`);
    }

    if (grp.channels.length === 0) {
      if (tbody) tbody.innerHTML = '';
      if (emptyMsg) {
        emptyMsg.style.display = 'block';
        emptyMsg.innerText = t('editor.grid.empty', {}, 'チャンネルがありません。「➕ 行追加」または「📋 一括貼付」で追加してください。');
      }
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    if (!tbody) return;

    tbody.innerHTML = '';

    grp.channels.forEach((chn, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.index = idx;

      // モジュレーション選択肢
      const mods = ['AUTO', 'AM', 'FM', 'NFM', 'WFM', 'FMB'];
      const modOptions = mods
        .map((m) => `<option value="${m}" ${chn.modulation === m ? 'selected' : ''}>${m}</option>`)
        .join('');

      // トーン選択肢
      const currentTone = chn.tone || 'None / All';
      let toneOptions = COMMON_TONES.map(
        (t) => `<option value="${t}" ${t === currentTone ? 'selected' : ''}>${t}</option>`
      ).join('');

      // もしカスタムトーンがあれば追加
      if (!COMMON_TONES.includes(currentTone)) {
        toneOptions = `<option value="${escapeHtml(currentTone)}" selected>${escapeHtml(currentTone)}</option>` + toneOptions;
      }

      tr.innerHTML = `
        <td class="col-num">${idx + 1}</td>
        <td class="col-name">
          <input type="text" class="grid-input" maxlength="16" value="${escapeHtml(chn.name || '')}"
                 placeholder="Alpha Tag" onchange="memoryEditor.onChannelFieldChange(${idx}, 'name', this.value)">
        </td>
        <td class="col-freq">
          <input type="text" class="grid-input freq-input" value="${escapeHtml(chn.frequency || '')}"
                 placeholder="145.0000" onchange="memoryEditor.onChannelFieldChange(${idx}, 'frequency', this.value)">
        </td>
        <td class="col-mod">
          <select class="grid-select" onchange="memoryEditor.onChannelFieldChange(${idx}, 'modulation', this.value)">
            ${modOptions}
          </select>
        </td>
        <td class="col-tone">
          <select class="grid-select" onchange="memoryEditor.onChannelFieldChange(${idx}, 'tone', this.value)">
            ${toneOptions}
          </select>
        </td>
        <td class="col-chk">
          <input type="checkbox" class="grid-checkbox" ${chn.lockout ? 'checked' : ''}
                 onchange="memoryEditor.onChannelFieldChange(${idx}, 'lockout', this.checked)">
        </td>
        <td class="col-chk">
          <input type="checkbox" class="grid-checkbox" ${chn.priority ? 'checked' : ''}
                 onchange="memoryEditor.onChannelFieldChange(${idx}, 'priority', this.checked)">
        </td>
        <td class="col-chk">
          <input type="checkbox" class="grid-checkbox" ${chn.attenuator ? 'checked' : ''}
                 onchange="memoryEditor.onChannelFieldChange(${idx}, 'attenuator', this.checked)">
        </td>
        <td class="col-actions">
          <button class="btn-icon-xs" title="${t('editor.grid.duplicateRowTitle', {}, '行複製')}" onclick="memoryEditor.onDuplicateChannelRow(${idx})">📄</button>
          <button class="btn-icon-xs" title="${t('editor.grid.deleteRowTitle', {}, '行削除')}" onclick="memoryEditor.onDeleteChannelRow(${idx})">🗑️</button>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  /**
   * HTMLエスケープユーティリティ
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 進捗ポーリングを開始する
   */
  function startProgressPolling() {
    if (progressPollTimer) clearInterval(progressPollTimer);

    const barFill = document.getElementById('progress-bar-fill');
    const percentEl = document.getElementById('progress-percent');
    const statusTextEl = document.getElementById('progress-status-text');

    progressPollTimer = setInterval(async () => {
      try {
        const prog = await app.fetchApi('/memory/progress');
        if (prog) {
          if (barFill) barFill.style.width = `${prog.percent || 0}%`;
          if (percentEl) percentEl.innerText = `${prog.percent || 0}%`;
          if (statusTextEl) statusTextEl.innerText = prog.message || t('editor.dialogs.communicating', {}, '通信中...');

          if (!prog.active && (prog.step === 'done' || prog.step === 'error')) {
            clearInterval(progressPollTimer);
            progressPollTimer = null;
            const footer = document.getElementById('progress-modal-footer');
            if (footer) footer.style.display = 'flex';
          }
        }
      } catch {
        // 無視
      }
    }, 400);
  }

  return {
    /**
     * 初期化処理
     */
    async init() {
      // 言語変更時にツリー・スプレッドシート・統計を即座に再描画
      window.addEventListener('languageChanged', () => {
        if (isEditorMode) {
          renderTree();
          updateStats();
          if (selectedGroupId) {
            renderChannelTable();
          } else if (selectedSystemId) {
            selectSystem(selectedSystemId);
          }
        }
      });
    },

    /**
     * エディタモードのトグル（app.jsから呼ばれる）
     */
    async toggleMode() {
      isEditorMode = !isEditorMode;
      const scannerView = document.getElementById('scanner-view');
      const editorView = document.getElementById('editor-view');
      const btn = document.getElementById('btn-toggle-editor');

      if (isEditorMode) {
        try {
          await app.fetchApi('/memory/mode', {
            method: 'POST',
            body: JSON.stringify({ action: 'enter' }),
          });
          if (scannerView) scannerView.classList.add('hidden');
          if (editorView) editorView.classList.remove('hidden');
          if (btn) {
            btn.innerHTML = typeof i18n !== 'undefined' ? i18n.t('header.returnToScanner') : '◀ スキャナーに戻る';
            btn.classList.replace('btn-primary', 'btn-warning');
          }

          // 初回ロード（メモリが空なら実機またはモックから読み出し）
          if (memorySystems.length === 0) {
            this.onDownloadFromScanner();
          } else {
            renderTree();
            updateStats();
          }
        } catch (err) {
          alert(t('editor.dialogs.enterProgModeFailed', { error: err.message }, 'プログラミングモードへの移行に失敗しました:\n' + err.message));
          isEditorMode = false;
        }
      } else {
        try {
          await app.fetchApi('/memory/mode', {
            method: 'POST',
            body: JSON.stringify({ action: 'exit' }),
          });
        } catch (err) {
          console.error('EPG失敗', err);
        }
        if (scannerView) scannerView.classList.remove('hidden');
        if (editorView) editorView.classList.add('hidden');
        if (btn) {
          btn.innerHTML = typeof i18n !== 'undefined' ? i18n.t('header.editorBtn') : '📝 エディタ起動';
          btn.classList.replace('btn-warning', 'btn-primary');
        }
      }
    },

    // --- 実機同期 (Download / Upload) ---

    /**
     * スキャナーから全メモリをダウンロードする
     */
    async onDownloadFromScanner() {
      const modal = document.getElementById('modal-progress');
      const title = document.getElementById('progress-modal-title');
      const footer = document.getElementById('progress-modal-footer');
      const barFill = document.getElementById('progress-bar-fill');
      const percentEl = document.getElementById('progress-percent');
      const statusTextEl = document.getElementById('progress-status-text');

      if (title) title.innerText = t('editor.progressModal.titleReading', {}, '📥 スキャナーから全メモリを読込中...');
      if (barFill) barFill.style.width = '0%';
      if (percentEl) percentEl.innerText = '0%';
      if (statusTextEl) statusTextEl.innerText = t('editor.dialogs.connecting', {}, '接続・初期化中...');
      if (footer) footer.style.display = 'none';
      if (modal) modal.classList.remove('hidden');

      startProgressPolling();

      try {
        const res = await app.fetchApi('/memory/all');
        if (res && Array.isArray(res.systems)) {
          memorySystems = res.systems;
          renderTree();
          updateStats();

          // 最初のグループがあれば自動選択
          if (memorySystems.length > 0 && memorySystems[0].groups && memorySystems[0].groups.length > 0) {
            selectGroup(memorySystems[0].id, memorySystems[0].groups[0].id);
          } else if (memorySystems.length > 0) {
            selectSystem(memorySystems[0].id);
          }
        }
      } catch (err) {
        alert(err.message);
      } finally {
        if (footer) footer.style.display = 'flex';
      }
    },

    /**
     * 全メモリをスキャナーへ書き込む
     */
    async onUploadToScanner() {
      if (memorySystems.length === 0) {
        alert(t('editor.dialogs.noSystemData', {}, '書き込むシステムデータがありません。'));
        return;
      }

      const warnMsg = t(
        'editor.dialogs.uploadWarning',
        {},
        '【警告】スキャナーの既存メモリを上書きします。\n※安全のため、実行前に現在の実機メモリがローカルに自動バックアップされます。\n\n書き込みを実行しますか？'
      );
      const confirmed = confirm(warnMsg);
      if (!confirmed) return;

      const modal = document.getElementById('modal-progress');
      const title = document.getElementById('progress-modal-title');
      const footer = document.getElementById('progress-modal-footer');
      const barFill = document.getElementById('progress-bar-fill');
      const percentEl = document.getElementById('progress-percent');
      const statusTextEl = document.getElementById('progress-status-text');

      if (title) title.innerText = t('editor.progressModal.titleWriting', {}, '📤 スキャナーへメモリ書き込み中...');
      if (barFill) barFill.style.width = '0%';
      if (percentEl) percentEl.innerText = '0%';
      if (statusTextEl) statusTextEl.innerText = t('editor.dialogs.prepBackup', {}, '事前バックアップ取得中...');
      if (footer) footer.style.display = 'none';
      if (modal) modal.classList.remove('hidden');

      startProgressPolling();

      try {
        await app.fetchApi('/memory/all', {
          method: 'POST',
          body: JSON.stringify({ systems: memorySystems }),
        });
      } catch (err) {
        alert(t('editor.dialogs.writeError', { error: err.message }, '書き込みエラー: ' + err.message));
      } finally {
        if (footer) footer.style.display = 'flex';
      }
    },

    /**
     * プログレスモーダルを閉じる
     */
    onCloseProgressModal() {
      const modal = document.getElementById('modal-progress');
      if (modal) modal.classList.add('hidden');
    },

    // --- チャンネルスプレッドシート編集 ---

    /**
     * チャンネルの各フィールド値変更ハンドラ
     * @param {number} chnIdx
     * @param {string} field
     * @param {any} value
     */
    onChannelFieldChange(chnIdx, field, value) {
      const grp = getCurrentGroup();
      if (!grp || !grp.channels || !grp.channels[chnIdx]) return;

      const chn = grp.channels[chnIdx];
      chn[field] = value;

      // 周波数フォーマットの微調整
      if (field === 'frequency') {
        const num = parseFloat(value);
        if (!isNaN(num)) {
          chn.frequency = num.toFixed(4);
        }
      }

      updateStats();
    },

    /**
     * チャンネル行追加
     */
    onAddChannelRow() {
      const grp = getCurrentGroup();
      if (!grp) {
        alert(t('editor.dialogs.selectGroupFirst', {}, '先に左のツリーからグループを選択してください。'));
        return;
      }

      if (!Array.isArray(grp.channels)) {
        grp.channels = [];
      }

      const newId = Date.now() + Math.floor(Math.random() * 1000);
      grp.channels.push({
        id: newId,
        name: `Ch ${grp.channels.length + 1}`,
        frequency: '145.0000',
        modulation: 'AUTO',
        tone: 'None / All',
        lockout: false,
        priority: false,
        attenuator: false,
        groupId: grp.id,
        systemId: selectedSystemId,
      });

      renderChannelTable();
      updateStats();
    },

    /**
     * チャンネル行複製
     * @param {number} idx
     */
    onDuplicateChannelRow(idx) {
      const grp = getCurrentGroup();
      if (!grp || !grp.channels || !grp.channels[idx]) return;

      const src = grp.channels[idx];
      const clone = JSON.parse(JSON.stringify(src));
      clone.id = Date.now() + Math.floor(Math.random() * 1000);
      clone.name = `${clone.name} (Copy)`.substring(0, 16);

      grp.channels.splice(idx + 1, 0, clone);
      renderChannelTable();
      updateStats();
    },

    /**
     * チャンネル行削除
     * @param {number} idx
     */
    onDeleteChannelRow(idx) {
      const grp = getCurrentGroup();
      if (!grp || !grp.channels || !grp.channels[idx]) return;

      grp.channels.splice(idx, 1);
      renderChannelTable();
      updateStats();
    },

    /**
     * 選択中グループの全チャンネルをクリア
     */
    onClearCurrentChannels() {
      const grp = getCurrentGroup();
      if (!grp || !grp.channels || grp.channels.length === 0) return;

      const msg = t('editor.dialogs.clearGroupConfirm', { name: grp.name, count: grp.channels.length }, `グループ「${grp.name}」の全 ${grp.channels.length} チャンネルを削除しますか？`);
      if (confirm(msg)) {
        grp.channels = [];
        renderChannelTable();
        updateStats();
      }
    },

    // --- Excel / クリップボード一括貼り付け ---

    onOpenPasteModal() {
      const grp = getCurrentGroup();
      if (!grp) {
        alert(t('editor.dialogs.selectGroupFirst', {}, '先にグループを選択してください。'));
        return;
      }
      const modal = document.getElementById('modal-paste');
      const textarea = document.getElementById('paste-textarea');
      if (textarea) textarea.value = '';
      if (modal) modal.classList.remove('hidden');
    },

    onClosePasteModal() {
      const modal = document.getElementById('modal-paste');
      if (modal) modal.classList.add('hidden');
    },

    onExecutePaste() {
      const grp = getCurrentGroup();
      if (!grp) return;

      const textarea = document.getElementById('paste-textarea');
      if (!textarea || !textarea.value.trim()) {
        alert(t('editor.dialogs.enterText', {}, 'テキストを入力してください。'));
        return;
      }

      const text = textarea.value.trim();
      const lines = text.split(/\r?\n/);
      let count = 0;

      if (!Array.isArray(grp.channels)) grp.channels = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        // タブ区切りまたはカンマ区切りで分解
        const delimiter = line.includes('\t') ? '\t' : ',';
        const parts = line.split(delimiter).map((p) => p.trim().replace(/^"(.*)"$/, '$1'));

        if (parts.length === 0) continue;

        let name = '';
        let freq = '';
        let mod = 'AUTO';
        let tone = 'None / All';

        // 判定: 数字や周波数パターンを探す
        for (let i = 0; i < parts.length; i++) {
          const val = parts[i];
          if (/^\d{2,4}\.\d{1,4}$/.test(val) || (/^\d{5,8}$/.test(val) && parseFloat(val) > 250000)) {
            freq = val;
            if (i > 0 && !name) name = parts[0];
            if (parts[i + 1] && ['AM', 'FM', 'NFM', 'WFM', 'FMB', 'AUTO'].includes(parts[i + 1].toUpperCase())) {
              mod = parts[i + 1].toUpperCase();
            }
            if (parts[i + 2]) {
              tone = parts[i + 2];
            }
            break;
          }
        }

        if (!freq && parts[0]) {
          // 最初の列が周波数の場合
          freq = parts[0];
          name = parts[1] || `Ch ${grp.channels.length + 1}`;
        }

        if (!name) name = `Ch ${grp.channels.length + 1}`;

        // 周波数のフォーマット正規化
        const freqNum = parseFloat(freq);
        if (!isNaN(freqNum)) {
          freq = freqNum.toFixed(4);
        }

        grp.channels.push({
          id: Date.now() + Math.floor(Math.random() * 10000) + count,
          name: name.substring(0, 16),
          frequency: freq,
          modulation: mod,
          tone: tone,
          lockout: false,
          priority: false,
          attenuator: false,
          groupId: grp.id,
          systemId: selectedSystemId,
        });

        count++;
      }

      this.onClosePasteModal();
      renderChannelTable();
      updateStats();
      alert(t('editor.dialogs.channelsAdded', { count }, `${count} 件のチャンネルを追加しました。`));
    },

    // --- システム / グループ 操作 ---

    onAddNewSystem() {
      const name = prompt(t('editor.dialogs.newSystemName', {}, '新規システム名を入力してください:'), 'Airband');
      if (!name) return;

      const qkStr = prompt(t('editor.dialogs.quickKeyPrompt', {}, 'クイックキー (0-99、未設定は空欄):'), '');
      const quickKey = qkStr && !isNaN(parseInt(qkStr, 10)) ? parseInt(qkStr, 10) : null;

      const newSysId = Date.now() + Math.floor(Math.random() * 1000);
      const newSys = {
        id: newSysId,
        name: name.substring(0, 16),
        type: 'CNV',
        quickKey,
        holdTime: 2,
        lockout: false,
        delay: 2,
        groups: [
          {
            id: newSysId + 1,
            name: 'Group 1',
            groupType: 'C',
            quickKey: 1,
            lockout: false,
            systemId: newSysId,
            channels: [],
          },
        ],
      };

      memorySystems.push(newSys);
      renderTree();
      updateStats();
      selectGroup(newSys.id, newSys.groups[0].id);
    },

    onEditSystem(sysId) {
      const sys = memorySystems.find((s) => String(s.id) === String(sysId));
      if (!sys) return;

      const newName = prompt(t('editor.dialogs.editSystemName', {}, 'システム名を編集:'), sys.name);
      if (newName !== null) sys.name = newName.substring(0, 16);

      const qkStr = prompt(t('editor.dialogs.quickKeyPrompt', {}, 'クイックキー (0-99、未設定は空欄):'), sys.quickKey !== null ? sys.quickKey : '');
      if (qkStr !== null) {
        sys.quickKey = qkStr.trim() !== '' && !isNaN(parseInt(qkStr, 10)) ? parseInt(qkStr, 10) : null;
      }

      renderTree();
    },

    onDeleteSystem(sysId) {
      const sys = memorySystems.find((s) => String(s.id) === String(sysId));
      if (!sys) return;

      const msg = t('editor.dialogs.deleteSystemConfirm', { name: sys.name }, `システム「${sys.name}」とその中の全グループ・チャンネルを削除しますか？`);
      if (confirm(msg)) {
        memorySystems = memorySystems.filter((s) => String(s.id) !== String(sysId));
        if (String(selectedSystemId) === String(sysId)) {
          selectedSystemId = null;
          selectedGroupId = null;
          selectSystem(null);
        }
        renderTree();
        updateStats();
      }
    },

    onAddNewGroup(sysId) {
      const sys = memorySystems.find((s) => String(s.id) === String(sysId));
      if (!sys) return;

      const promptMsg = t('editor.dialogs.newGroupName', { sysName: sys.name }, `システム「${sys.name}」に追加するグループ名:`);
      const name = prompt(promptMsg, 'Tower');
      if (!name) return;

      const qkStr = prompt(t('editor.dialogs.groupQuickKeyPrompt', {}, 'グループクイックキー (1-10、未設定は空欄):'), '');
      const quickKey = qkStr && !isNaN(parseInt(qkStr, 10)) ? parseInt(qkStr, 10) : null;

      const newGrpId = Date.now() + Math.floor(Math.random() * 1000);
      if (!Array.isArray(sys.groups)) sys.groups = [];

      const newGrp = {
        id: newGrpId,
        name: name.substring(0, 16),
        groupType: 'C',
        quickKey,
        lockout: false,
        systemId: sys.id,
        channels: [],
      };

      sys.groups.push(newGrp);
      renderTree();
      updateStats();
      selectGroup(sys.id, newGrpId);
    },

    onEditGroup(sysId, grpId) {
      const sys = memorySystems.find((s) => String(s.id) === String(sysId));
      if (!sys || !sys.groups) return;
      const grp = sys.groups.find((g) => String(g.id) === String(grpId));
      if (!grp) return;

      const newName = prompt(t('editor.dialogs.editGroupName', {}, 'グループ名を編集:'), grp.name);
      if (newName !== null) grp.name = newName.substring(0, 16);

      const qkStr = prompt(t('editor.dialogs.groupQuickKeyPrompt', {}, 'グループクイックキー (1-10、未設定は空欄):'), grp.quickKey !== null ? grp.quickKey : '');
      if (qkStr !== null) {
        grp.quickKey = qkStr.trim() !== '' && !isNaN(parseInt(qkStr, 10)) ? parseInt(qkStr, 10) : null;
      }

      renderTree();
      if (String(selectedGroupId) === String(grpId)) {
        renderChannelTable();
      }
    },

    onEditCurrentGroup() {
      if (selectedSystemId && selectedGroupId) {
        this.onEditGroup(selectedSystemId, selectedGroupId);
      }
    },

    onDeleteGroup(sysId, grpId) {
      const sys = memorySystems.find((s) => String(s.id) === String(sysId));
      if (!sys || !sys.groups) return;
      const grp = sys.groups.find((g) => String(g.id) === String(grpId));
      if (!grp) return;

      const msg = t('editor.dialogs.deleteGroupConfirm', { name: grp.name }, `グループ「${grp.name}」とそのチャンネルを削除しますか？`);
      if (confirm(msg)) {
        sys.groups = sys.groups.filter((g) => String(g.id) !== String(grpId));
        if (String(selectedGroupId) === String(grpId)) {
          selectedGroupId = null;
          selectSystem(sysId);
        }
        renderTree();
        updateStats();
      }
    },

    // --- ファイルインポート / エクスポート ---

    onExportJson() {
      if (memorySystems.length === 0) {
        alert(t('editor.dialogs.noDataToSave', {}, '保存するデータがありません。'));
        return;
      }
      const dataStr = JSON.stringify(memorySystems, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bct15x_memory_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    onImportJson(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (Array.isArray(parsed)) {
            memorySystems = parsed;
            renderTree();
            updateStats();
            if (memorySystems.length > 0 && memorySystems[0].groups && memorySystems[0].groups.length > 0) {
              selectGroup(memorySystems[0].id, memorySystems[0].groups[0].id);
            }
            alert(t('editor.dialogs.jsonLoaded', {}, 'JSONデータを読み込みました。'));
          } else {
            alert(t('editor.dialogs.invalidJson', {}, '無効なJSON形式です。システムの配列である必要があります。'));
          }
        } catch (err) {
          alert(t('editor.dialogs.jsonLoadError', { error: err.message }, 'JSON読み込みエラー: ' + err.message));
        }
      };
      reader.readAsText(file);
      event.target.value = ''; // リセット
    },

    onExportCsv() {
      window.location.href = '/api/memory/export/csv';
    },

    onImportCsv(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const csvText = e.target.result;
          const res = await app.fetchApi('/memory/import/csv', {
            method: 'POST',
            headers: { 'Content-Type': 'text/csv' },
            body: csvText,
          });

          if (res && Array.isArray(res.systems)) {
            memorySystems = res.systems;
            renderTree();
            updateStats();
            if (memorySystems.length > 0 && memorySystems[0].groups && memorySystems[0].groups.length > 0) {
              selectGroup(memorySystems[0].id, memorySystems[0].groups[0].id);
            }
            alert(t('editor.dialogs.csvImported', { count: res.count }, `CSVから ${res.count} 件のシステムをインポートしました。`));
          }
        } catch (err) {
          alert(t('editor.dialogs.csvImportError', { error: err.message }, 'CSVインポートエラー: ' + err.message));
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    },

    // --- バックアップ履歴モーダル ---

    async onOpenBackupsModal() {
      const modal = document.getElementById('modal-backups');
      const listEl = document.getElementById('backups-list');
      if (modal) modal.classList.remove('hidden');
      if (listEl) listEl.innerHTML = `<li class="loading">${t('editor.backupsModal.loading', {}, 'バックアップ履歴を取得中...')}</li>`;

      try {
        const backups = await app.fetchApi('/memory/backups');
        if (!backups || backups.length === 0) {
          if (listEl) listEl.innerHTML = `<li class="loading">${t('editor.backupsModal.empty', {}, 'バックアップ履歴はありません')}</li>`;
          return;
        }

        listEl.innerHTML = '';
        backups.forEach((b) => {
          const li = document.createElement('li');
          li.className = 'backup-item';
          const localeCode = typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'en-US' : 'ja-JP';
          const dateStr = new Date(b.updatedAt).toLocaleString(localeCode);
          const sizeKb = (b.size / 1024).toFixed(1);
          const metaText = t('editor.dialogs.backupMeta', { date: dateStr, size: sizeKb }, `日時: ${dateStr} | サイズ: ${sizeKb} KB`);
          const restoreText = t('editor.backupsModal.restore', {}, '復元');

          li.innerHTML = `
            <div class="backup-info">
              <span class="backup-name">${escapeHtml(b.filename)}</span>
              <span class="backup-date">${escapeHtml(metaText)}</span>
            </div>
            <button class="btn btn-sm btn-primary" onclick="memoryEditor.onRestoreBackup('${b.filename}')">${escapeHtml(restoreText)}</button>
          `;
          listEl.appendChild(li);
        });
      } catch (err) {
        if (listEl) listEl.innerHTML = `<li class="loading error">${t('editor.dialogs.fetchError', { error: err.message }, '取得エラー: ' + err.message)}</li>`;
      }
    },

    onCloseBackupsModal() {
      const modal = document.getElementById('modal-backups');
      if (modal) modal.classList.add('hidden');
    },

    async onRestoreBackup(filename) {
      const confirmMsg = t('editor.dialogs.restoreBackupConfirm', { name: filename }, `バックアップ「${filename}」をエディタに復元しますか？`);
      if (!confirm(confirmMsg)) return;

      try {
        const data = await app.fetchApi(`/memory/backups/${encodeURIComponent(filename)}`);
        if (Array.isArray(data)) {
          memorySystems = data;
          renderTree();
          updateStats();
          if (memorySystems.length > 0 && memorySystems[0].groups && memorySystems[0].groups.length > 0) {
            selectGroup(memorySystems[0].id, memorySystems[0].groups[0].id);
          }
          this.onCloseBackupsModal();
          alert(t('editor.dialogs.backupRestored', {}, 'バックアップを復元しました。'));
        }
      } catch (err) {
        alert(t('editor.dialogs.restoreError', { error: err.message }, '復元エラー: ' + err.message));
      }
    },
  };
})();
