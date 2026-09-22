/**
 * @fileoverview 受信ログモジュール
 * @description 受信履歴の表示、カラムカスタマイズ、CSVエクスポート、ログクリア機能を管理する
 */

/**
 * 受信ログUI管理
 */
const activityLog = (() => {
  /** @type {Array<Object>} ログエントリー配列 */
  let logEntries = [];
  
  /** @type {number} フィルタ前の総件数 */
  let totalUnfiltered = 0;

  /** @type {Object} 現在のフィルタ条件 */
  let currentFilters = {};

  /** @type {number} 最大表示件数 */
  const MAX_DISPLAY = 200;

  /** @type {string} localStorage用キー */
  const STORAGE_KEY = 'bct15x_log_columns';

  /**
   * 利用可能な全カラム定義
   * @type {Array<Object>}
   */
  const AVAILABLE_COLUMNS = [
    { id: 'time',       label: '時刻',         field: 'startTime',    cssClass: 'time-cell',  format: formatTime },
    { id: 'freqTgid',   label: '周波数/TGID',  field: 'freqTgid',     cssClass: 'freq-cell',  fallbackField: 'rawFreqTgid' },
    { id: 'system',     label: 'システム',     field: 'system',       cssClass: '' },
    { id: 'department', label: 'デパートメント', field: 'department',  cssClass: '' },
    { id: 'channel',    label: 'チャンネル',    field: 'channel',     cssClass: '' },
    { id: 'modulation', label: 'モード',        field: 'modulation',  cssClass: '' },
    { id: 'ctcssDcs',   label: 'CTCSS/DCS',    field: 'ctcssDcs',     cssClass: '' },
    { id: 'p25nac',     label: 'P25 NAC',      field: 'p25nac',       cssClass: '' },
    { id: 'duration',   label: '秒数',          field: 'durationSec', cssClass: '',           format: formatDuration },
  ];

  /**
   * デフォルトの表示カラムID一覧（順序を含む）
   * @type {Array<string>}
   */
  const DEFAULT_COLUMN_IDS = ['time', 'freqTgid', 'system', 'channel', 'modulation', 'duration'];

  /**
   * 現在の表示カラム設定（カラムIDの配列、順序あり）
   * @type {Array<string>}
   */
  let activeColumnIds = [];

  /**
   * カラム設定をlocalStorageから読み込む
   */
  function loadColumnSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 保存された設定の中で、まだ有効なカラムIDのみをフィルタ
        const validIds = AVAILABLE_COLUMNS.map(c => c.id);
        activeColumnIds = parsed.filter(id => validIds.includes(id));
        if (activeColumnIds.length === 0) {
          activeColumnIds = [...DEFAULT_COLUMN_IDS];
        }
      } else {
        activeColumnIds = [...DEFAULT_COLUMN_IDS];
      }
    } catch {
      activeColumnIds = [...DEFAULT_COLUMN_IDS];
    }
  }

  /**
   * カラム設定をlocalStorageに保存する
   */
  function saveColumnSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeColumnIds));
    } catch {
      // localStorage書き込み失敗は無視
    }
  }

  /**
   * カラムIDからカラム定義を取得する
   * @param {string} columnId - カラムID
   * @returns {Object|undefined} カラム定義
   */
  function getColumnDef(columnId) {
    return AVAILABLE_COLUMNS.find(c => c.id === columnId);
  }

  /**
   * 現在のアクティブカラム定義配列を取得する
   * @returns {Array<Object>}
   */
  function getActiveColumns() {
    return activeColumnIds.map(id => getColumnDef(id)).filter(Boolean);
  }

  // 初期化時にカラム設定を読み込む
  loadColumnSettings();

  /**
   * 受信開始イベント処理
   * @param {Object} data - 受信開始データ
   */
  function onReceptionStart(data) {
    // 受信開始時は仮エントリーを追加（終了時に更新される）
  }

  /**
   * 受信終了イベント処理（ログエントリー追加）
   * @param {Object} data - 受信終了データ
   */
  function onReceptionEnd(data) {
    if (!data || !data.logEntry) return;

    const entry = data.logEntry;
    
    // クライアント側でフィルタ適用
    if (!applyFiltersToEntry(entry, currentFilters)) {
      totalUnfiltered++;
      updateFilterCount();
      return;
    }

    logEntries.unshift(entry);
    totalUnfiltered++;

    // 最大件数を超えたら古いものを削除
    if (logEntries.length > MAX_DISPLAY) {
      logEntries = logEntries.slice(0, MAX_DISPLAY);
    }

    addLogRow(entry, true);
    updateEmptyState();
    updateFilterCount();
  }

  /**
   * 単一のエントリーにフィルタを適用する（クライアント側用）
   * @param {Object} entry 
   * @param {Object} filters 
   * @returns {boolean}
   */
  function applyFiltersToEntry(entry, filters) {
    if (Object.keys(filters).length === 0) return true;

    if (filters.dateFrom && entry.startTime) {
      if (new Date(entry.startTime) < new Date(filters.dateFrom)) return false;
    }
    if (filters.dateTo && entry.startTime) {
      if (new Date(entry.startTime) > new Date(filters.dateTo)) return false;
    }
    if (filters.freq) {
      const eFreq = (entry.freqTgid || entry.rawFreqTgid || '').toLowerCase();
      if (!eFreq.includes(filters.freq.toLowerCase())) return false;
    }
    if (filters.system) {
      const eSys = (entry.system || '').toLowerCase();
      if (!eSys.includes(filters.system.toLowerCase())) return false;
    }
    if (filters.channel) {
      const eChan = (entry.channel || '').toLowerCase();
      if (!eChan.includes(filters.channel.toLowerCase())) return false;
    }
    if (filters.modulation) {
      const eMod = (entry.modulation || '').toLowerCase();
      if (eMod !== filters.modulation.toLowerCase()) return false;
    }
    if (filters.minDuration !== undefined) {
      if ((entry.durationSec || 0) < parseFloat(filters.minDuration)) return false;
    }

    return true;
  }

  /**
   * サーバーからのログデータ受信処理
   * @param {Object} data - ログデータ
   * @param {Array<Object>} data.entries - ログエントリー配列
   * @param {number} data.total - 総件数
   * @param {number} data.totalUnfiltered - フィルタ前の総件数
   */
  function onLogData(data) {
    logEntries = data.entries || [];
    totalUnfiltered = data.totalUnfiltered !== undefined ? data.totalUnfiltered : (data.total || logEntries.length);
    renderTable();
    updateFilterCount();
  }
  
  // ---------- フィルタ機能 ----------

  /**
   * フィルタバーの表示/非表示を切り替える
   */
  function onToggleFilter() {
    const bar = document.getElementById('log-filter-bar');
    const btn = document.getElementById('btn-log-filter');
    
    if (bar.classList.contains('collapsed')) {
      bar.classList.remove('collapsed');
      bar.classList.add('expanded');
      btn.classList.add('active');
    } else {
      bar.classList.remove('expanded');
      bar.classList.add('collapsed');
      btn.classList.remove('active');
    }
  }

  /**
   * フィルタを適用してサーバーから再取得
   */
  async function onApplyFilter() {
    const filters = {};
    const val = (id) => document.getElementById(id).value.trim();

    if (val('log-filter-date-from')) filters.dateFrom = val('log-filter-date-from');
    if (val('log-filter-date-to')) filters.dateTo = val('log-filter-date-to');
    if (val('log-filter-freq')) filters.freq = val('log-filter-freq');
    if (val('log-filter-system')) filters.system = val('log-filter-system');
    if (val('log-filter-channel')) filters.channel = val('log-filter-channel');
    if (val('log-filter-modulation')) filters.modulation = val('log-filter-modulation');
    if (val('log-filter-min-duration')) filters.minDuration = val('log-filter-min-duration');

    currentFilters = filters;
    
    try {
      const queryParams = new URLSearchParams(filters);
      queryParams.append('limit', MAX_DISPLAY);
      const res = await app.fetchApi(`/log?${queryParams.toString()}`);
      onLogData(res);
    } catch (err) {
      console.error('[ActivityLog] フィルタ適用エラー:', err);
    }
  }

  /**
   * フィルタをリセットする
   */
  async function onResetFilter() {
    document.getElementById('log-filter-date-from').value = '';
    document.getElementById('log-filter-date-to').value = '';
    document.getElementById('log-filter-freq').value = '';
    document.getElementById('log-filter-system').value = '';
    document.getElementById('log-filter-channel').value = '';
    document.getElementById('log-filter-modulation').value = '';
    document.getElementById('log-filter-min-duration').value = '';

    currentFilters = {};
    
    try {
      const res = await app.fetchApi(`/log?limit=${MAX_DISPLAY}`);
      onLogData(res);
    } catch (err) {
      console.error('[ActivityLog] フィルタ適用エラー:', err);
    }
  }

  /**
   * フィルタ結果件数表示を更新
   */
  function updateFilterCount() {
    const countEl = document.getElementById('log-filter-count');
    if (Object.keys(currentFilters).length > 0) {
      countEl.innerHTML = `フィルタ適用中: <span>${logEntries.length}</span> / ${totalUnfiltered} 件`;
      countEl.classList.remove('hidden');
    } else {
      countEl.classList.add('hidden');
    }
  }

  /**
   * テーブルのヘッダーを描画する
   */
  function renderHeader() {
    const thead = document.querySelector('#log-table thead');
    if (!thead) return;

    const tr = document.createElement('tr');
    const columns = getActiveColumns();

    for (const col of columns) {
      const th = document.createElement('th');
      th.textContent = col.label;
      tr.appendChild(th);
    }

    thead.innerHTML = '';
    thead.appendChild(tr);
  }

  /**
   * ログテーブル全体を再描画する
   */
  function renderTable() {
    renderHeader();

    const tbody = document.getElementById('log-tbody');
    tbody.innerHTML = '';

    for (const entry of logEntries) {
      addLogRow(entry, false);
    }

    updateEmptyState();
  }

  /**
   * ログテーブルに行を追加する（アクティブカラム設定に基づく）
   * @param {Object} entry - ログエントリー
   * @param {boolean} isNew - 新着エントリーかどうか（アニメーション用）
   */
  function addLogRow(entry, isNew) {
    const tbody = document.getElementById('log-tbody');
    const tr = document.createElement('tr');

    if (isNew) {
      tr.classList.add('new-entry');
    }

    const columns = getActiveColumns();

    for (const col of columns) {
      const td = document.createElement('td');

      // 値を取得
      let value = entry[col.field];
      if ((value === undefined || value === null || value === '') && col.fallbackField) {
        value = entry[col.fallbackField];
      }

      // フォーマット関数がある場合は適用
      if (col.format) {
        td.textContent = col.format(value);
      } else {
        td.textContent = value || '---';
      }

      // CSSクラスを追加
      if (col.cssClass) {
        td.className = col.cssClass;
      }

      tr.appendChild(td);
    }

    // 先頭に追加（新しいものが上）
    if (isNew && tbody.firstChild) {
      tbody.insertBefore(tr, tbody.firstChild);
    } else {
      tbody.appendChild(tr);
    }

    // 表示件数制限
    while (tbody.children.length > MAX_DISPLAY) {
      tbody.removeChild(tbody.lastChild);
    }
  }

  /**
   * 空状態の表示を更新する
   */
  function updateEmptyState() {
    const empty = document.getElementById('log-empty');
    const tbody = document.getElementById('log-tbody');

    if (tbody.children.length === 0) {
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
    }
  }

  /**
   * CSV形式でログをエクスポートする（アクティブカラム設定に基づく）
   */
  function onExportCsv() {
    if (logEntries.length === 0) {
      alert('エクスポートするログがありません');
      return;
    }

    const columns = getActiveColumns();
    const headers = columns.map(col => col.label);

    const rows = logEntries.map(entry => {
      return columns.map(col => {
        let value = entry[col.field];
        if ((value === undefined || value === null || value === '') && col.fallbackField) {
          value = entry[col.fallbackField];
        }
        if (col.format) {
          return col.format(value);
        }
        return value || '';
      });
    });

    // BOM付きUTF-8 CSV
    const bom = '\uFEFF';
    const csvContent = bom + [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const filename = `reception_log_${dateStr}.csv`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * ログをクリアする
   */
  async function onClearLog() {
    if (!confirm('受信ログをすべてクリアしますか？')) return;

    try {
      await app.fetchApi('/log', { method: 'DELETE' });
      logEntries = [];
      renderTable();
    } catch (err) {
      console.error('[ActivityLog] ログクリアエラー:', err);
    }
  }

  // ---------- カラム設定モーダル ----------

  /**
   * カラム設定モーダルを開く
   */
  function onOpenColumnSettings() {
    const modal = document.getElementById('column-settings-modal');
    if (!modal) return;

    renderColumnSettingsContent();
    modal.classList.remove('hidden');
  }

  /**
   * カラム設定モーダルを閉じる
   */
  function onCloseColumnSettings() {
    const modal = document.getElementById('column-settings-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * カラム設定モーダルの内容を描画する
   */
  function renderColumnSettingsContent() {
    const listEl = document.getElementById('column-settings-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    for (const col of AVAILABLE_COLUMNS) {
      const isActive = activeColumnIds.includes(col.id);

      const item = document.createElement('div');
      item.className = `column-setting-item${isActive ? ' active' : ''}`;
      item.dataset.columnId = col.id;
      item.draggable = true;

      item.innerHTML = `
        <span class="column-drag-handle" title="ドラッグで順序変更">⋮⋮</span>
        <label class="column-checkbox-label">
          <input type="checkbox" ${isActive ? 'checked' : ''} 
                 onchange="activityLog.onColumnToggle('${col.id}', this.checked)">
          <span>${escapeHtml(col.label)}</span>
        </label>
      `;

      // ドラッグ＆ドロップイベント
      item.addEventListener('dragstart', onDragStart);
      item.addEventListener('dragover', onDragOver);
      item.addEventListener('drop', onDrop);
      item.addEventListener('dragend', onDragEnd);

      listEl.appendChild(item);
    }
  }

  /** @type {HTMLElement|null} 現在ドラッグ中の要素 */
  let draggedItem = null;

  /**
   * ドラッグ開始
   * @param {DragEvent} e
   */
  function onDragStart(e) {
    draggedItem = e.currentTarget;
    draggedItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  }

  /**
   * ドラッグオーバー
   * @param {DragEvent} e
   */
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.currentTarget;
    if (!draggedItem || target === draggedItem) return;

    const listEl = document.getElementById('column-settings-list');
    const items = [...listEl.children];
    const dragIdx = items.indexOf(draggedItem);
    const targetIdx = items.indexOf(target);

    if (dragIdx < targetIdx) {
      listEl.insertBefore(draggedItem, target.nextSibling);
    } else {
      listEl.insertBefore(draggedItem, target);
    }
  }

  /**
   * ドロップ
   * @param {DragEvent} e
   */
  function onDrop(e) {
    e.preventDefault();
    applyColumnOrderFromDom();
  }

  /**
   * ドラッグ終了
   * @param {DragEvent} e
   */
  function onDragEnd(e) {
    if (draggedItem) {
      draggedItem.classList.remove('dragging');
      draggedItem = null;
    }
    applyColumnOrderFromDom();
  }

  /**
   * DOM上のカラム順序からactiveColumnIdsを再構築する
   */
  function applyColumnOrderFromDom() {
    const listEl = document.getElementById('column-settings-list');
    if (!listEl) return;

    const newActiveIds = [];
    const items = listEl.querySelectorAll('.column-setting-item');

    for (const item of items) {
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (checkbox && checkbox.checked) {
        newActiveIds.push(item.dataset.columnId);
      }
    }

    if (newActiveIds.length > 0) {
      activeColumnIds = newActiveIds;
      saveColumnSettings();
      renderTable();
    }
  }

  /**
   * カラムの表示/非表示を切り替える
   * @param {string} columnId - カラムID
   * @param {boolean} checked - チェック状態
   */
  function onColumnToggle(columnId, checked) {
    if (checked) {
      // アクティブリストに追加（DOM順序に基づく位置に挿入）
      if (!activeColumnIds.includes(columnId)) {
        // DOM上の順序で適切な位置に挿入
        applyColumnOrderFromDom();
        return;
      }
    } else {
      // アクティブリストから除去（最低1カラムは残す）
      const newIds = activeColumnIds.filter(id => id !== columnId);
      if (newIds.length === 0) {
        // チェックを戻す
        const listEl = document.getElementById('column-settings-list');
        const item = listEl.querySelector(`[data-column-id="${columnId}"] input`);
        if (item) item.checked = true;
        return;
      }
      activeColumnIds = newIds;
    }

    // item要素のactiveクラスを更新
    const listEl = document.getElementById('column-settings-list');
    const item = listEl.querySelector(`[data-column-id="${columnId}"]`);
    if (item) {
      item.classList.toggle('active', checked);
    }

    saveColumnSettings();
    renderTable();
  }

  /**
   * カラム設定をデフォルトに戻す
   */
  function onResetColumns() {
    activeColumnIds = [...DEFAULT_COLUMN_IDS];
    saveColumnSettings();
    renderColumnSettingsContent();
    renderTable();
  }

  // ---------- ユーティリティ ----------

  /**
   * ISO日時文字列を表示用にフォーマットする
   * @param {string} isoString - ISO 8601形式の日付文字列
   * @returns {string} フォーマットされた時刻文字列
   */
  function formatTime(isoString) {
    if (!isoString) return '---';

    const d = new Date(isoString);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * 秒数をフォーマットする
   * @param {number|undefined} sec - 秒数
   * @returns {string} フォーマットされた秒数文字列
   */
  function formatDuration(sec) {
    if (sec === undefined || sec === null) return '---';
    return `${sec}s`;
  }

  /**
   * HTML特殊文字をエスケープする
   * @param {string} str - 入力文字列
   * @returns {string} エスケープ済み文字列
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // DOMContentLoaded後にテーブルヘッダーを初期描画
  document.addEventListener('DOMContentLoaded', () => {
    renderHeader();
  });

  // 公開API
  return {
    onReceptionStart,
    onReceptionEnd,
    onLogData,
    onExportCsv,
    onClearLog,
    onOpenColumnSettings,
    onCloseColumnSettings,
    onColumnToggle,
    onResetColumns,
    onToggleFilter,
    onApplyFilter,
    onResetFilter,
  };
})();
