/**
 * @fileoverview Recording Panel Module
 * @description Manages recorded audio files list, smart continuous playback, tags filtering, download, and deletion UI
 */

/**
 * Recording Panel UI controller
 */
const recordingPanel = (() => {
  /** @type {Array<Object>} Recording file list */
  let recordings = [];

  /** @type {number} Currently playing index (-1 if none) */
  let currentIndex = -1;

  /** @type {string|null} Currently playing filename */
  let currentlyPlaying = null;

  /** @type {boolean} Auto-play next track */
  let isAutoPlayNext = true;

  /** @type {'desc'|'asc'} Play order / Sort order */
  let playOrder = 'desc';

  /** @type {number} Playback speed */
  let playbackRate = 1.0;

  /** @type {Object} Filter criteria */
  let currentFilters = {
    datePreset: '',
    system: '',
    department: '',
    channel: '',
    minDuration: '',
    search: '',
  };

  /** @type {number|null} Search debounce timer ID */
  let searchTimeoutId = null;

  /** @type {boolean} Tags fetched flag */
  let tagsLoaded = false;

  /**
   * Fetch distinct systems, departments, channels for filter options
   */
  async function fetchTags() {
    try {
      const tags = await app.fetchApi('/recordings/tags');
      populateTagOptions('rec-filter-system', tags.systems || []);
      populateTagOptions('rec-filter-department', tags.departments || []);
      populateTagOptions('rec-filter-channel', tags.channels || []);
      tagsLoaded = true;
    } catch {
      // Ignore
    }
  }

  /**
   * Populate select dropdown with tag options
   * @param {string} selectId
   * @param {string[]} options
   */
  function populateTagOptions(selectId, options) {
    const el = document.getElementById(selectId);
    if (!el) return;

    const currentValue = el.value;
    const firstOption = el.options[0];

    el.innerHTML = '';
    if (firstOption) el.appendChild(firstOption);

    options.forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt;
      optionEl.textContent = opt;
      el.appendChild(optionEl);
    });

    el.value = currentValue;
  }

  /**
   * Build query URL from active filters
   * @returns {string}
   */
  function buildQueryUrl() {
    const params = new URLSearchParams();
    if (currentFilters.datePreset) params.set('datePreset', currentFilters.datePreset);
    if (currentFilters.system) params.set('system', currentFilters.system);
    if (currentFilters.department) params.set('department', currentFilters.department);
    if (currentFilters.channel) params.set('channel', currentFilters.channel);
    if (currentFilters.minDuration) params.set('minDuration', currentFilters.minDuration);
    if (currentFilters.search) params.set('search', currentFilters.search);

    const queryString = params.toString();
    return queryString ? `/recordings?${queryString}` : '/recordings';
  }

  /**
   * Refresh recording file list
   */
  async function onRefresh() {
    if (!tagsLoaded) {
      fetchTags();
    }

    try {
      const url = buildQueryUrl();
      const data = await app.fetchApi(url);
      recordings = data.recordings || [];
      sortRecordings();
      renderList();
    } catch (err) {
      console.error('[RecordingPanel] Failed to fetch list:', err);
    }
  }

  /**
   * Sort recordings according to playOrder
   */
  function sortRecordings() {
    recordings.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return playOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });

    // Update currentIndex if playing
    if (currentlyPlaying) {
      currentIndex = recordings.findIndex((r) => r.filename === currentlyPlaying);
    }
  }

  /**
   * Handle filter value changes
   */
  function onFilterChange() {
    const dateEl = document.getElementById('rec-filter-date');
    const sysEl = document.getElementById('rec-filter-system');
    const deptEl = document.getElementById('rec-filter-department');
    const chnEl = document.getElementById('rec-filter-channel');
    const minDurEl = document.getElementById('rec-filter-min-duration');

    currentFilters.datePreset = dateEl ? dateEl.value : '';
    currentFilters.system = sysEl ? sysEl.value : '';
    currentFilters.department = deptEl ? deptEl.value : '';
    currentFilters.channel = chnEl ? chnEl.value : '';
    currentFilters.minDuration = minDurEl ? minDurEl.value : '';

    onRefresh();
  }

  /**
   * Apply filters explicitly
   */
  function onApplyFilters() {
    onFilterChange();
  }

  /**
   * Reset all filters
   */
  function onResetFilters() {
    const dateEl = document.getElementById('rec-filter-date');
    const sysEl = document.getElementById('rec-filter-system');
    const deptEl = document.getElementById('rec-filter-department');
    const chnEl = document.getElementById('rec-filter-channel');
    const minDurEl = document.getElementById('rec-filter-min-duration');
    const searchEl = document.getElementById('rec-search-input');

    if (dateEl) dateEl.value = '';
    if (sysEl) sysEl.value = '';
    if (deptEl) deptEl.value = '';
    if (chnEl) chnEl.value = '';
    if (minDurEl) minDurEl.value = '';
    if (searchEl) searchEl.value = '';

    currentFilters = {
      datePreset: '',
      system: '',
      department: '',
      channel: '',
      minDuration: '',
      search: '',
    };

    onRefresh();
  }

  /**
   * Handle search input change event
   * @param {string} val - Query text
   */
  function onSearchChange(val) {
    currentFilters.search = val.trim();
    if (searchTimeoutId) {
      clearTimeout(searchTimeoutId);
    }
    searchTimeoutId = setTimeout(() => {
      onRefresh();
    }, 300);
  }

  /**
   * Render recording file list
   */
  function renderList() {
    const list = document.getElementById('recording-list');
    const empty = document.getElementById('recordings-empty');

    if (!list || !empty) return;

    if (recordings.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    list.innerHTML = recordings
      .map((rec) => {
        const isPlaying = rec.filename === currentlyPlaying;
        const activeClass = isPlaying ? ' active' : '';

        // Formatted display
        const parts = rec.filename.split('/');
        const basename = parts.pop();
        const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';
        const formattedDir = dirPath ? `<span class="rec-path">${escapeHtml(dirPath)}</span>` : '';
        const formattedName = `${formattedDir}${escapeHtml(basename)}`;

        // Tags summary
        const tags = [];
        if (rec.system) tags.push(`<span class="smart-player-tag">${escapeHtml(rec.system)}</span>`);
        if (rec.channel) tags.push(`<span class="smart-player-tag">${escapeHtml(rec.channel)}</span>`);
        if (rec.frequency) tags.push(`<span class="smart-player-tag">${escapeHtml(rec.frequency)} MHz</span>`);
        const tagHtml = tags.length > 0 ? `<div class="rec-tags" style="margin-top:2px;">${tags.join(' ')}</div>` : '';

        const playBtnLabel = isPlaying ? '⏸' : '▶';

        return `
        <li class="recording-item${activeClass}" data-filename="${escapeHtml(rec.filename)}">
          <div class="rec-icon">${isPlaying ? '🔊' : '🎵'}</div>
          <div class="rec-info">
            <div class="rec-name" title="${escapeHtml(rec.filename)}">${formattedName}</div>
            <div class="rec-meta">${rec.sizeFormatted} · ${formatDate(rec.createdAt)}${rec.durationSec ? ` · ${rec.durationSec}s` : ''}</div>
            ${tagHtml}
          </div>
          <div class="rec-actions">
            <button class="btn" onclick="recordingPanel.onPlay('${escapeJs(rec.filename)}')" title="${typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Play' : '再生'}">${playBtnLabel}</button>
            <button class="btn" onclick="recordingPanel.onDownload('${escapeJs(rec.filename)}')" title="${typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Download' : 'ダウンロード'}">📥</button>
            <button class="btn btn-danger" onclick="recordingPanel.onDelete('${escapeJs(rec.filename)}')" title="${typeof i18n !== 'undefined' && i18n.getLanguage() === 'en' ? 'Delete' : '削除'}">🗑</button>
          </div>
        </li>
        `;
      })
      .join('');
  }

  /**
   * Play recording file by filename
   * @param {string} filename - Filename to play
   */
  function onPlay(filename) {
    const targetIndex = recordings.findIndex((r) => r.filename === filename);
    if (targetIndex === -1) return;

    playAtIndex(targetIndex);
  }

  /**
   * Play recording file by array index
   * @param {number} index
   */
  function playAtIndex(index) {
    if (index < 0 || index >= recordings.length) return;

    const rec = recordings[index];
    currentIndex = index;
    currentlyPlaying = rec.filename;

    const container = document.getElementById('audio-player-container');
    const player = document.getElementById('audio-player');
    const nameSpan = document.getElementById('now-playing-name');
    const tagsSpan = document.getElementById('now-playing-tags');

    if (container) container.classList.remove('hidden');

    // Title display
    const title = rec.channel ? `${rec.channel} (${rec.frequency || ''}MHz)` : rec.filename;
    if (nameSpan) nameSpan.textContent = title;

    // Tags
    if (tagsSpan) {
      const tags = [];
      if (rec.system) tags.push(`<span class="smart-player-tag">${escapeHtml(rec.system)}</span>`);
      if (rec.department) tags.push(`<span class="smart-player-tag">${escapeHtml(rec.department)}</span>`);
      tagsSpan.innerHTML = tags.join(' ');
    }

    if (player) {
      // Audio stream URL (safely encode each path component)
      const encodedPath = rec.filename.split('/').map(encodeURIComponent).join('/');
      player.src = `/api/recordings/${encodedPath}`;
      player.playbackRate = playbackRate;
      player.play().catch(() => {});
    }

    // Update MediaSession
    updateMediaSession(rec);

    renderList();
  }

  /**
   * Play next recording in sequence
   */
  function onPlayNext() {
    if (recordings.length === 0) return;

    let nextIndex = currentIndex + 1;
    if (nextIndex >= recordings.length) {
      console.log('[RecordingPanel] Reached end of recording list');
      return;
    }
    playAtIndex(nextIndex);
  }

  /**
   * Play previous recording
   */
  function onPlayPrev() {
    if (recordings.length === 0) return;

    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = 0;
    }
    playAtIndex(prevIndex);
  }

  /**
   * Toggle auto-play next track
   * @param {boolean} checked
   */
  function onToggleAutoPlayNext(checked) {
    isAutoPlayNext = checked;
  }

  /**
   * Change play / sort order
   * @param {'desc'|'asc'} order
   */
  function onChangePlayOrder(order) {
    playOrder = order;
    sortRecordings();
    renderList();
  }

  /**
   * Change playback speed
   * @param {string|number} speed
   */
  function onChangePlaySpeed(speed) {
    playbackRate = parseFloat(speed) || 1.0;
    const player = document.getElementById('audio-player');
    if (player) {
      player.playbackRate = playbackRate;
    }
  }

  /**
   * Update MediaSession API for lock screen and notification playback controls
   * @param {Object} rec
   */
  function updateMediaSession(rec) {
    if (!('mediaSession' in navigator) || !rec) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: rec.channel ? `${rec.channel} (${rec.frequency || ''})` : rec.filename,
        artist: rec.system || 'Scanner Audio',
        album: rec.department || 'BCT15X Scanner',
        artwork: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });

      const player = document.getElementById('audio-player');
      if (player) {
        navigator.mediaSession.setActionHandler('play', () => player.play());
        navigator.mediaSession.setActionHandler('pause', () => player.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => onPlayPrev());
        navigator.mediaSession.setActionHandler('nexttrack', () => onPlayNext());
      }
    } catch {
      // Ignore media session errors
    }
  }

  /**
   * Download recording file
   * @param {string} filename - Filename to download
   */
  function onDownload(filename) {
    const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
    const a = document.createElement('a');
    a.href = `/api/recordings/${encodedPath}`;
    a.download = filename.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Delete recording file
   * @param {string} filename - Filename to delete
   */
  async function onDelete(filename) {
    app.requireOperator(async () => {
      const confirmMsg = typeof i18n !== 'undefined'
        ? i18n.t('recordings.deleteConfirm', { filename })
        : `「${filename}」を削除しますか？`;
      if (!confirm(confirmMsg)) return;

      try {
        const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
        await app.fetchApi(`/recordings/${encodedPath}`, {
          method: 'DELETE',
        });

        // Stop audio player if currently playing this file
        if (currentlyPlaying === filename) {
          const player = document.getElementById('audio-player');
          if (player) {
            player.pause();
            player.src = '';
          }
          const container = document.getElementById('audio-player-container');
          if (container) container.classList.add('hidden');
          currentlyPlaying = null;
          currentIndex = -1;
        }

        // Remove from list
        recordings = recordings.filter((r) => r.filename !== filename);
        renderList();
      } catch (err) {
        console.error('[RecordingPanel] Delete error:', err);
        const errMsg = typeof i18n !== 'undefined'
          ? i18n.t('recordings.deleteFailed', { error: err.message })
          : `削除に失敗しました: ${err.message}`;
        alert(errMsg);
      }
    });
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

  // Audio player continuous play event handler
  document.addEventListener('DOMContentLoaded', () => {
    const player = document.getElementById('audio-player');
    if (player) {
      player.addEventListener('ended', () => {
        if (isAutoPlayNext) {
          onPlayNext();
        }
      });
      player.addEventListener('play', () => {
        player.playbackRate = playbackRate;
      });
    }
  });

  // Re-render on language change
  window.addEventListener('languageChanged', () => {
    if (recordings.length > 0) {
      renderList();
    }
  });

  // Public API
  return {
    onRefresh,
    onPlay,
    onPlayNext,
    onPlayPrev,
    onToggleAutoPlayNext,
    onChangePlayOrder,
    onChangePlaySpeed,
    onDownload,
    onDelete,
    onRecordingStart,
    onRecordingStop,
    onSearchChange,
    onFilterChange,
    onApplyFilters,
    onResetFilters,
  };
})();
