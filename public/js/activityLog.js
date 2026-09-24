/**
 * @fileoverview Activity Log Module
 * @description Manages reception history display, column customization, CSV export, and log clearing
 */

/**
 * Activity Log UI Controller
 */
const activityLog = (() => {
  /** @type {Array<Object>} Log entry records */
  let logEntries = [];
  
  /** @type {number} Total count before filtering */
  let totalUnfiltered = 0;

  /** @type {Object} Current active filter conditions */
  let currentFilters = {};

  /** @type {number} Maximum entries to display in DOM */
  const MAX_DISPLAY = 200;

  /** @type {string} localStorage cache key for column settings */
  const STORAGE_KEY = 'bct15x_log_columns';

  /**
   * Complete list of available column definitions
   * @type {Array<Object>}
   */
  const AVAILABLE_COLUMNS = [
    { id: 'playback',   label: '再生',         i18nKey: 'log.colPlayback',   field: 'recordingFile', cssClass: 'playback-cell' },
    { id: 'time',       label: '時刻',         i18nKey: 'log.colTime',       field: 'startTime',    cssClass: 'time-cell',  format: formatTime },
    { id: 'freqTgid',   label: '周波数/TGID',  i18nKey: 'log.colFreq',       field: 'freqTgid',     cssClass: 'freq-cell',  fallbackField: 'rawFreqTgid' },
    { id: 'system',     label: 'システム',     i18nKey: 'log.colSystem',     field: 'system',       cssClass: '' },
    { id: 'department', label: 'デパートメント', i18nKey: 'log.colDepartment', field: 'department',  cssClass: '' },
    { id: 'channel',    label: 'チャンネル',    i18nKey: 'log.colChannel',    field: 'channel',     cssClass: '' },
    { id: 'modulation', label: 'モード',        i18nKey: 'log.colMod',        field: 'modulation',  cssClass: '' },
    { id: 'ctcssDcs',   label: 'CTCSS/DCS',    i18nKey: 'log.colTone',       field: 'ctcssDcs',     cssClass: '' },
    { id: 'p25nac',     label: 'P25 NAC',      i18nKey: 'log.colNac',        field: 'p25nac',       cssClass: '' },
    { id: 'duration',   label: '秒数',          i18nKey: 'log.colDuration',   field: 'durationSec', cssClass: '',           format: formatDuration },
  ];

  /**
   * Get localized column display label
   * @param {Object} col - Column definition
   * @returns {string} Localized label
   */
  function getColumnLabel(col) {
    if (typeof i18n !== 'undefined' && col.i18nKey) {
      const translated = i18n.t(col.i18nKey);
      if (translated && translated !== col.i18nKey) {
        return translated;
      }
    }
    return col.label;
  }

  /**
   * Default active column IDs with order
   * @type {Array<string>}
   */
  const DEFAULT_COLUMN_IDS = ['playback', 'time', 'freqTgid', 'system', 'channel', 'modulation', 'duration'];

  /**
   * Current active column IDs with ordering
   * @type {Array<string>}
   */
  let activeColumnIds = [];

  /**
   * Load column preferences from localStorage
   */
  function loadColumnSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Keep only column IDs that still exist in AVAILABLE_COLUMNS
        const validIds = AVAILABLE_COLUMNS.map(c => c.id);
        activeColumnIds = parsed.filter(id => validIds.includes(id));
        // Auto-insert playback column if not present in legacy saved settings
        if (!activeColumnIds.includes('playback')) {
          activeColumnIds.unshift('playback');
        }
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
   * Save column preferences to localStorage
   */
  function saveColumnSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeColumnIds));
    } catch {
      // Ignore localStorage write failures
    }
  }

  /**
   * Find column definition by ID
   * @param {string} columnId - Column ID
   * @returns {Object|undefined} Column definition
   */
  function getColumnDef(columnId) {
    return AVAILABLE_COLUMNS.find(c => c.id === columnId);
  }

  /**
   * Get array of currently active column definitions
   * @returns {Array<Object>}
   */
  function getActiveColumns() {
    return activeColumnIds.map(id => getColumnDef(id)).filter(Boolean);
  }

  // Load column preferences on script execution
  loadColumnSettings();

  /**
   * Handle reception start event
   * @param {Object} data - Event payload
   */
  function onReceptionStart(data) {
    // Optional placeholder on reception start (updated on end)
  }

  /**
   * Handle reception end event (appends new log entry)
   * @param {Object} data - Event payload
   */
  function onReceptionEnd(data) {
    if (!data || !data.logEntry) return;

    const entry = data.logEntry;
    
    // Apply filters client-side
    if (!applyFiltersToEntry(entry, currentFilters)) {
      totalUnfiltered++;
      updateFilterCount();
      return;
    }

    logEntries.unshift(entry);
    totalUnfiltered++;

    // Evict oldest entries exceeding MAX_DISPLAY limit
    if (logEntries.length > MAX_DISPLAY) {
      logEntries = logEntries.slice(0, MAX_DISPLAY);
    }

    addLogRow(entry, true);
    updateEmptyState();
    updateFilterCount();
  }

  /**
   * Test whether a log entry matches current filter criteria
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
   * Process log history batch received from server
   * @param {Object} data - Log payload
   * @param {Array<Object>} data.entries - Log entries
   * @param {number} data.total - Total filtered count
   * @param {number} data.totalUnfiltered - Total unfiltered count
   */
  function onLogData(data) {
    logEntries = data.entries || [];
    totalUnfiltered = data.totalUnfiltered !== undefined ? data.totalUnfiltered : (data.total || logEntries.length);
    renderTable();
    updateFilterCount();
  }
  
  // ---------- Filter Controls ----------

  /**
   * Toggle filter bar visibility
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
   * Apply filters and re-fetch from server
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
   * Reset all filter inputs and reload log history
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
   * Update filter count badge label
   */
  function updateFilterCount() {
    const countEl = document.getElementById('log-filter-count');
    if (Object.keys(currentFilters).length > 0) {
      if (typeof i18n !== 'undefined') {
        countEl.innerHTML = i18n.t('log.filterActive', { count: `<span>${logEntries.length}</span>`, total: totalUnfiltered });
      } else {
        countEl.innerHTML = `フィルタ適用中: <span>${logEntries.length}</span> / ${totalUnfiltered} 件`;
      }
      countEl.classList.remove('hidden');
    } else {
      countEl.classList.add('hidden');
    }
  }

  /**
   * Render table headers based on active columns
   */
  function renderHeader() {
    const thead = document.querySelector('#log-table thead');
    if (!thead) return;

    const tr = document.createElement('tr');
    const columns = getActiveColumns();

    for (const col of columns) {
      const th = document.createElement('th');
      th.textContent = getColumnLabel(col);
      tr.appendChild(th);
    }

    thead.innerHTML = '';
    thead.appendChild(tr);
  }

  /**
   * Re-render entire log table body
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
   * Add row to log table according to active column settings
   * @param {Object} entry - Log entry object
   * @param {boolean} isNew - Whether this is a newly arrived entry (triggers highlight animation)
   */
  function addLogRow(entry, isNew) {
    const tbody = document.getElementById('log-tbody');
    const tr = document.createElement('tr');
    if (entry.id) {
      tr.dataset.logId = String(entry.id);
    }

    if (isNew) {
      tr.classList.add('new-entry');
    }

    const columns = getActiveColumns();

    for (const col of columns) {
      const td = document.createElement('td');

      // Playback action column
      if (col.id === 'playback') {
        td.className = 'playback-cell';
        if (entry.recordingFile) {
          const btn = document.createElement('button');
          btn.className = 'btn-log-play';
          btn.title = typeof i18n !== 'undefined' ? i18n.t('log.playTooltip') : 'この通信の録音を再生';
          btn.innerHTML = '▶';
          btn.onclick = (e) => {
            e.stopPropagation();
            onPlayLogAudio(entry.recordingFile, tr, entry);
          };
          td.appendChild(btn);
        } else {
          td.innerHTML = '<span class="log-no-audio">-</span>';
        }
        tr.appendChild(td);
        continue;
      }

      // Retrieve cell value
      let value = entry[col.field];
      if ((value === undefined || value === null || value === '') && col.fallbackField) {
        value = entry[col.fallbackField];
      }

      // Apply formatter function if defined
      if (col.format) {
        td.textContent = col.format(value);
      } else {
        td.textContent = value || '---';
      }

      // Add custom CSS class if defined
      if (col.cssClass) {
        td.className = col.cssClass;
      }

      tr.appendChild(td);
    }

    // Prepend new row to top of table
    if (isNew && tbody.firstChild) {
      tbody.insertBefore(tr, tbody.firstChild);
    } else {
      tbody.appendChild(tr);
    }

    // Enforce DOM row count limit
    while (tbody.children.length > MAX_DISPLAY) {
      tbody.removeChild(tbody.lastChild);
    }
  }

  /**
   * Update empty log placeholder visibility
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
   * Export log entries as CSV file based on active column preferences
   */
  function onExportCsv() {
    if (logEntries.length === 0) {
      alert(typeof i18n !== 'undefined' ? i18n.t('log.exportEmpty') : 'エクスポートするログがありません');
      return;
    }

    const columns = getActiveColumns();
    const headers = columns.map(col => getColumnLabel(col));

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

    // UTF-8 with BOM for proper Excel compatibility
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
   * Clear all log entries on server and in UI
   */
  async function onClearLog() {
    const confirmMsg = typeof i18n !== 'undefined' ? i18n.t('log.clearConfirm') : '受信ログをすべてクリアしますか？';
    if (!confirm(confirmMsg)) return;

    try {
      await app.fetchApi('/log', { method: 'DELETE' });
      logEntries = [];
      renderTable();
    } catch (err) {
      console.error('[ActivityLog] ログクリアエラー:', err);
    }
  }

  // ---------- Column Settings Modal ----------

  /**
   * Open column configuration modal
   */
  function onOpenColumnSettings() {
    const modal = document.getElementById('column-settings-modal');
    if (!modal) return;

    renderColumnSettingsContent();
    modal.classList.remove('hidden');
  }

  /**
   * Close column configuration modal
   */
  function onCloseColumnSettings() {
    const modal = document.getElementById('column-settings-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  /**
   * Render column configuration modal items with drag handles
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

      const colLabel = getColumnLabel(col);
      item.innerHTML = `
        <span class="column-drag-handle" title="ドラッグで順序変更">⋮⋮</span>
        <label class="column-checkbox-label">
          <input type="checkbox" ${isActive ? 'checked' : ''} 
                 onchange="activityLog.onColumnToggle('${col.id}', this.checked)">
          <span>${escapeHtml(colLabel)}</span>
        </label>
      `;

      // Attach drag-and-drop events for reordering
      item.addEventListener('dragstart', onDragStart);
      item.addEventListener('dragover', onDragOver);
      item.addEventListener('drop', onDrop);
      item.addEventListener('dragend', onDragEnd);

      listEl.appendChild(item);
    }
  }

  /** @type {HTMLElement|null} Currently dragged item element */
  let draggedItem = null;

  /**
   * Handle drag start
   * @param {DragEvent} e
   */
  function onDragStart(e) {
    draggedItem = e.currentTarget;
    draggedItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  }

  /**
   * Handle drag over
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
   * Handle drag drop
   * @param {DragEvent} e
   */
  function onDrop(e) {
    e.preventDefault();
    applyColumnOrderFromDom();
  }

  /**
   * Handle drag end
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
   * Reconstruct activeColumnIds order from current DOM order
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
   * Toggle column visibility checkbox
   * @param {string} columnId - Column ID
   * @param {boolean} checked - Checked state
   */
  function onColumnToggle(columnId, checked) {
    if (checked) {
      // Add to active list in proper DOM order position
      if (!activeColumnIds.includes(columnId)) {
        // Insert in accordance with DOM order
        applyColumnOrderFromDom();
        return;
      }
    } else {
      // Remove from active list (enforce at least one column remains)
      const newIds = activeColumnIds.filter(id => id !== columnId);
      if (newIds.length === 0) {
        // Revert checkbox state
        const listEl = document.getElementById('column-settings-list');
        const item = listEl.querySelector(`[data-column-id="${columnId}"] input`);
        if (item) item.checked = true;
        return;
      }
      activeColumnIds = newIds;
    }

    // Update active class on list item element
    const listEl = document.getElementById('column-settings-list');
    const item = listEl.querySelector(`[data-column-id="${columnId}"]`);
    if (item) {
      item.classList.toggle('active', checked);
    }

    saveColumnSettings();
    renderTable();
  }

  /**
   * Reset column settings to defaults
   */
  function onResetColumns() {
    activeColumnIds = [...DEFAULT_COLUMN_IDS];
    saveColumnSettings();
    renderColumnSettingsContent();
    renderTable();
  }

  // ---------- Utilities ----------

  /**
   * Format ISO date string for log table display
   * @param {string} isoString - ISO 8601 date string
   * @returns {string} Formatted time string
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
   * Format duration in seconds
   * @param {number|undefined} sec - Duration in seconds
   * @returns {string} Formatted duration string
   */
  function formatDuration(sec) {
    if (sec === undefined || sec === null) return '---';
    return `${sec}s`;
  }

  /**
   * Escape HTML special characters
   * @param {string} str - Input string
   * @returns {string} Escaped string
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Render table headers on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    renderHeader();
  });

  // Re-render table and column settings on languageChanged
  window.addEventListener('languageChanged', () => {
    renderTable();
    updateFilterCount();
    const modal = document.getElementById('column-settings-modal');
    if (modal && !modal.classList.contains('hidden')) {
      renderColumnSettingsContent();
    }
  });

  /**
   * Play audio recording associated with a log row
   * @param {string} filename - Recording filename
   * @param {HTMLElement} trElement - Table row element
   * @param {Object} [entry] - Log entry metadata
   */
  function onPlayLogAudio(filename, trElement, entry = {}) {
    if (!filename || typeof recordingPanel === 'undefined') return;

    // Remove active highlight from previously playing rows
    const playingRows = document.querySelectorAll('#log-tbody tr.log-row-playing');
    playingRows.forEach(r => r.classList.remove('log-row-playing'));

    if (trElement) {
      trElement.classList.add('log-row-playing');
    }

    // Call recordingPanel player in single-play mode with metadata fallback
    recordingPanel.onPlay(
      filename,
      {
        system: entry.system,
        department: entry.department,
        channel: entry.channel,
        frequency: entry.freqTgid || entry.rawFreqTgid,
      },
      { isSinglePlay: true }
    );

    // Listen to audio player pause/ended to clear highlight
    const player = document.getElementById('audio-player');
    if (player) {
      const onEndedOrPaused = () => {
        if (trElement) trElement.classList.remove('log-row-playing');
        player.removeEventListener('ended', onEndedOrPaused);
        player.removeEventListener('pause', onEndedOrPaused);
      };
      player.addEventListener('ended', onEndedOrPaused);
      player.addEventListener('pause', onEndedOrPaused);
    }
  }

  /**
   * Handle real-time log entry update (e.g. recording file attached)
   * @param {Object} data - Update payload
   * @param {Object} data.logEntry - Updated log entry
   */
  function onLogEntryUpdated(data) {
    if (!data) return;
    const updated = data.logEntry || data;
    if (!updated || !updated.recordingFile) return;

    // Update in memory array
    let target = null;
    if (updated.id) {
      target = logEntries.find(e => e.id === updated.id);
    }
    if (!target && logEntries.length > 0) {
      target = logEntries.find(e => !e.recordingFile) || logEntries[0];
    }
    if (target) {
      target.recordingFile = updated.recordingFile;
    }

    // Update in DOM
    const tbody = document.getElementById('log-tbody');
    if (!tbody) return;

    let tr = null;
    if (updated.id) {
      tr = tbody.querySelector(`tr[data-log-id="${updated.id}"]`);
    }
    if (!tr) {
      // Find the first row whose playback-cell still displays "-"
      const rows = Array.from(tbody.querySelectorAll('tr'));
      tr = rows.find(r => r.querySelector('.log-no-audio')) || tbody.firstChild;
    }

    if (tr && updated.recordingFile) {
      const cell = tr.querySelector('.playback-cell');
      if (cell) {
        cell.innerHTML = '';
        const btn = document.createElement('button');
        btn.className = 'btn-log-play';
        btn.title = typeof i18n !== 'undefined' ? i18n.t('log.playTooltip') : 'この通信の録音を再生';
        btn.innerHTML = '▶';
        btn.onclick = (e) => {
          e.stopPropagation();
          onPlayLogAudio(updated.recordingFile, tr, target || updated);
        };
        cell.appendChild(btn);
        console.log('[ActivityLog] 🔗 Play button rendered for row:', updated.recordingFile);
      }
    }
  }

  // Public API
  return {
    onReceptionStart,
    onReceptionEnd,
    onLogData,
    onLogEntryUpdated,
    onPlayLogAudio,
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
