/**
 * @fileoverview 操作マニュアル・ヘルプパネル管理モジュール
 * @description 操作画面と同時に見ながら操作できるサイドパネル形式のインタラクティブマニュアル
 */

/**
 * 操作マニュアルパネルコントローラー
 */
const manualPanel = (() => {
  /** @type {boolean} パネルが開いているかどうかの状態 */
  let isOpen = false;

  /** @type {string} 現在選択されているマニュアルタブ ('practice' | 'buttons' | 'shortcuts' | 'overview') */
  let currentTab = 'practice';

  /**
   * マニュアルパネルの開閉を切り替える
   */
  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }

  /**
   * マニュアルパネルを開く
   * @param {string} [tab] - 開くタブ指定
   */
  function open(tab) {
    if (tab) {
      currentTab = tab;
    }
    const drawer = document.getElementById('manual-drawer');
    const toggleBtn = document.getElementById('btn-manual-toggle');
    if (drawer) {
      drawer.classList.add('open');
      isOpen = true;
    }
    if (toggleBtn) {
      toggleBtn.classList.add('active');
    }
    renderTab(currentTab);
  }

  /**
   * マニュアルパネルを閉じる
   */
  function close() {
    const drawer = document.getElementById('manual-drawer');
    const toggleBtn = document.getElementById('btn-manual-toggle');
    if (drawer) {
      drawer.classList.remove('open');
      isOpen = false;
    }
    if (toggleBtn) {
      toggleBtn.classList.remove('active');
    }
  }

  /**
   * 表示するマニュアルタブを切り替える
   * @param {string} tabName - タブ識別子
   */
  function setTab(tabName) {
    currentTab = tabName;
    const tabButtons = document.querySelectorAll('.manual-tab-btn');
    tabButtons.forEach((btn) => {
      if (btn.getAttribute('data-tab') === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    const contentPanes = document.querySelectorAll('.manual-tab-pane');
    contentPanes.forEach((pane) => {
      if (pane.getAttribute('data-pane') === tabName) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });
  }

  /**
   * 指定したタブを描画する
   * @param {string} tabName - タブ名
   */
  function renderTab(tabName) {
    setTab(tabName);
  }

  /**
   * マニュアル内の検索フィルター
   * @param {string} query - 検索文字列
   */
  function onSearch(query) {
    const term = (query || '').toLowerCase().trim();
    const activePane = document.querySelector('.manual-tab-pane.active');
    if (!activePane) return;

    const cards = activePane.querySelectorAll('.manual-card, .manual-table-row, .shortcut-item');
    cards.forEach((card) => {
      const text = card.textContent.toLowerCase();
      if (!term || text.includes(term)) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    });
  }

  /**
   * 初期化イベントのセットアップ
   */
  function init() {
    const searchInput = document.getElementById('manual-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => onSearch(e.target.value));
    }

    // Escキーで閉じる（モーダル等と被らない場合）
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        const authModal = document.getElementById('auth-modal');
        if (!authModal || authModal.classList.contains('hidden')) {
          close();
        }
      }
    });
  }

  // 初期化実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 公開API
  return {
    toggle,
    open,
    close,
    setTab,
    onSearch,
  };
})();
