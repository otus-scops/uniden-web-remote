/**
 * @fileoverview Recording Panel Module
 * @description Manages recorded audio files list, playback, download, and deletion UI
 */

/**
 * Recording Panel UI controller
 */
const recordingPanel = (() => {
  /** @type {Array<Object>} Recording file list */
  let recordings = [];

  /** @type {string|null} Currently playing filename */
  let currentlyPlaying = null;

  /** @type {string} Search query */
  let searchQuery = '';
  
  /** @type {number|null} Search debounce timer ID */
  let searchTimeoutId = null;

  /**
   * Refresh recording file list
   */
  async function onRefresh() {
    try {
      let url = '/recordings';
      if (searchQuery) {
        url += `?search=${encodeURIComponent(searchQuery)}`;
      }
      const data = await app.fetchApi(url);
      recordings = data.recordings || [];
      renderList();
    } catch (err) {
      console.error('[RecordingPanel] Failed to fetch list:', err);
    }
  }

  /**
   * Render recording file list
   */
  function renderList() {
    const list = document.getElementById('recording-list');
    const empty = document.getElementById('recordings-empty');

    if (recordings.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    list.innerHTML = recordings.map((rec) => {
      // Split directory path and base filename
      const parts = rec.filename.split('/');
      const basename = parts.pop();
      const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';
      
      const formattedDir = dirPath ? `<span class="rec-path">${escapeHtml(dirPath)}</span>` : '';
      const formattedName = `${formattedDir}${escapeHtml(basename)}`;

      return `
      <li class="recording-item" data-filename="${escapeHtml(rec.filename)}">
        <div class="rec-icon">🎵</div>
        <div class="rec-info">
          <div class="rec-name" title="${escapeHtml(rec.filename)}">${formattedName}</div>
          <div class="rec-meta">${rec.sizeFormatted} · ${formatDate(rec.createdAt)}</div>
        </div>
        <div class="rec-actions">
          <button class="btn" onclick="recordingPanel.onPlay('${escapeJs(rec.filename)}')" title="${typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Play' : '再生'}">▶</button>
          <button class="btn" onclick="recordingPanel.onDownload('${escapeJs(rec.filename)}')" title="${typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Download' : 'ダウンロード'}">📥</button>
          <button class="btn btn-danger" onclick="recordingPanel.onDelete('${escapeJs(rec.filename)}')" title="${typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Delete' : '削除'}">🗑</button>
        </div>
      </li>
      `;
    }).join('');
  }

  /**
   * Handle search input change event
   * @param {string} val - Query text
   */
  function onSearchChange(val) {
    searchQuery = val.trim();
    if (searchTimeoutId) {
      clearTimeout(searchTimeoutId);
    }
    searchTimeoutId = setTimeout(() => {
      onRefresh();
    }, 300);
  }

  /**
   * Play recording file
   * @param {string} filename - Filename to play
   */
  function onPlay(filename) {
    const container = document.getElementById('audio-player-container');
    const player = document.getElementById('audio-player');
    const nameSpan = document.getElementById('now-playing-name');

    container.classList.remove('hidden');
    nameSpan.textContent = filename;
    player.src = `/api/recordings/${encodeURIComponent(filename)}`;
    player.play();
    currentlyPlaying = filename;
  }

  /**
   * Download recording file
   * @param {string} filename - Filename to download
   */
  function onDownload(filename) {
    const a = document.createElement('a');
    a.href = `/api/recordings/${encodeURIComponent(filename)}`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Delete recording file
   * @param {string} filename - Filename to delete
   */
  async function onDelete(filename) {
    const confirmMsg = typeof i18n !== 'undefined'
      ? i18n.t('recordings.deleteConfirm', { filename })
      : `「${filename}」を削除しますか？`;
    if (!confirm(confirmMsg)) return;

    try {
      await app.fetchApi(`/recordings/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });

      // Stop audio player if currently playing this file
      if (currentlyPlaying === filename) {
        const player = document.getElementById('audio-player');
        player.pause();
        player.src = '';
        document.getElementById('audio-player-container').classList.add('hidden');
        currentlyPlaying = null;
      }

      // Remove from list
      recordings = recordings.filter(r => r.filename !== filename);
      renderList();
    } catch (err) {
      console.error('[RecordingPanel] Delete error:', err);
      const errMsg = typeof i18n !== 'undefined'
        ? i18n.t('recordings.deleteFailed', { error: err.message })
        : `削除に失敗しました: ${err.message}`;
      alert(errMsg);
    }
  }

  /**
   * Handle recording start event
   * @param {Object} data - Event payload
   */
  function onRecordingStart(data) {
    console.log('[RecordingPanel] Recording started:', data.filename);
  }

  /**
   * Handle recording stop event
   * @param {Object} data - Event payload
   */
  function onRecordingStop(data) {
    console.log('[RecordingPanel] Recording stopped:', data.filename);
    // Refresh file list
    setTimeout(() => onRefresh(), 500);
  }

  /**
   * Format ISO date string for display
   * @param {string} isoString - ISO 8601 date string
   * @returns {string} Formatted date string
   */
  function formatDate(isoString) {
    const d = new Date(isoString);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
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

  /**
   * Escape string for JavaScript string literal
   * @param {string} str - Input string
   * @returns {string} Escaped string
   */
  function escapeJs(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
  }

  // Re-render tooltips and labels on language change
  window.addEventListener('languageChanged', () => {
    if (recordings.length > 0) {
      renderList();
    }
  });

  // Public API
  return {
    onRefresh,
    onPlay,
    onDownload,
    onDelete,
    onRecordingStart,
    onRecordingStop,
    onSearchChange,
  };
})();
