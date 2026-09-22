/**
 * @fileoverview 録音パネルモジュール
 * @description 録音ファイルリスト表示、再生、ダウンロード、削除のUIを管理する
 */

/**
 * 録音パネルUI管理
 */
const recordingPanel = (() => {
  /** @type {Array<Object>} 録音ファイルリスト */
  let recordings = [];

  /** @type {string|null} 現在再生中のファイル名 */
  let currentlyPlaying = null;

  /** @type {string} 検索クエリ */
  let searchQuery = '';
  
  /** @type {number} デバウンス用タイマーID */
  let searchTimeoutId = null;

  /**
   * 録音ファイルリストを更新する
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
      console.error('[RecordingPanel] リスト取得エラー:', err);
    }
  }

  /**
   * 録音ファイルリストを描画する
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
      // ディレクトリパスとファイル名を分離
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
          <button class="btn" onclick="recordingPanel.onPlay('${escapeJs(rec.filename)}')" title="再生">▶</button>
          <button class="btn" onclick="recordingPanel.onDownload('${escapeJs(rec.filename)}')" title="ダウンロード">📥</button>
          <button class="btn btn-danger" onclick="recordingPanel.onDelete('${escapeJs(rec.filename)}')" title="削除">🗑</button>
        </div>
      </li>
      `;
    }).join('');
  }

  /**
   * 検索入力の変更イベント
   * @param {string} val 
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
   * 録音ファイルを再生する
   * @param {string} filename - ファイル名
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
   * 録音ファイルをダウンロードする
   * @param {string} filename - ファイル名
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
   * 録音ファイルを削除する
   * @param {string} filename - ファイル名
   */
  async function onDelete(filename) {
    if (!confirm(`「${filename}」を削除しますか？`)) return;

    try {
      await app.fetchApi(`/recordings/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });

      // 再生中のファイルなら停止
      if (currentlyPlaying === filename) {
        const player = document.getElementById('audio-player');
        player.pause();
        player.src = '';
        document.getElementById('audio-player-container').classList.add('hidden');
        currentlyPlaying = null;
      }

      // リストから削除
      recordings = recordings.filter(r => r.filename !== filename);
      renderList();
    } catch (err) {
      console.error('[RecordingPanel] 削除エラー:', err);
      alert('削除に失敗しました: ' + err.message);
    }
  }

  /**
   * 録音開始イベント処理
   * @param {Object} data - 録音開始データ
   */
  function onRecordingStart(data) {
    console.log('[RecordingPanel] 録音開始:', data.filename);
  }

  /**
   * 録音停止イベント処理
   * @param {Object} data - 録音停止データ
   */
  function onRecordingStop(data) {
    console.log('[RecordingPanel] 録音停止:', data.filename);
    // リストを更新
    setTimeout(() => onRefresh(), 500);
  }

  /**
   * 日付文字列をフォーマットする
   * @param {string} isoString - ISO 8601形式の日付文字列
   * @returns {string} フォーマットされた日付文字列
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
   * HTML特殊文字をエスケープする
   * @param {string} str - 入力文字列
   * @returns {string} エスケープ済み文字列
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * JavaScript文字列リテラル用にエスケープする
   * @param {string} str - 入力文字列
   * @returns {string} エスケープ済み文字列
   */
  function escapeJs(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
  }

  // 公開API
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
