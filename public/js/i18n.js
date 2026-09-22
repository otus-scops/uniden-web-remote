/**
 * @fileoverview 軽量多言語化 (i18n) 管理モジュール (Vanilla JS)
 * @description JSON辞書の動的読み込み、言語切り替え、DOM属性自動置換、パラメータ展開
 */

const i18n = (function () {
  /** @type {string} デフォルト言語 */
  const DEFAULT_LANGUAGE = 'ja';

  /** @type {string} サポート言語リスト */
  const SUPPORTED_LANGUAGES = ['ja', 'en'];

  /** @type {string} 現在の言語コード */
  let currentLanguage = DEFAULT_LANGUAGE;

  /** @type {Object<string, Object>} ロード済み辞書キャッシュ */
  const translationsCache = {};

  /**
   * ブラウザ設定またはストレージから適切な言語を決定する
   * @returns {string} 言語コード
   */
  function detectLanguage() {
    const saved = localStorage.getItem('bct15x_language');
    if (saved && SUPPORTED_LANGUAGES.includes(saved)) {
      return saved;
    }
    const navLang = (navigator.language || '').toLowerCase();
    if (navLang.startsWith('en')) {
      return 'en';
    }
    return DEFAULT_LANGUAGE;
  }

  /**
   * 指定した言語の辞書JSONをロードする
   * @param {string} lang
   * @returns {Promise<Object>}
   */
  async function loadLocale(lang) {
    if (translationsCache[lang]) {
      return translationsCache[lang];
    }
    try {
      const res = await fetch(`/locales/${lang}.json?v=${Date.now()}`);
      if (!res.ok) {
        throw new Error(`Failed to load /locales/${lang}.json (status: ${res.status})`);
      }
      const data = await res.json();
      translationsCache[lang] = data;
      return data;
    } catch (err) {
      console.error(`[i18n] 言語ファイルの取得に失敗しました: ${lang}`, err);
      // フォールバック
      if (lang !== DEFAULT_LANGUAGE && translationsCache[DEFAULT_LANGUAGE]) {
        return translationsCache[DEFAULT_LANGUAGE];
      }
      return {};
    }
  }

  /**
   * ドット区切りのキーからネストされた辞書オブジェクトの文字列を解決する
   * @param {Object} obj
   * @param {string} keyPath
   * @returns {string|null}
   */
  function resolveKey(obj, keyPath) {
    if (!obj || !keyPath) return null;
    const parts = keyPath.split('.');
    let cur = obj;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) {
        cur = cur[part];
      } else {
        return null;
      }
    }
    return typeof cur === 'string' ? cur : null;
  }

  return {
    /**
     * 初期化処理
     * @returns {Promise<void>}
     */
    async init() {
      currentLanguage = detectLanguage();
      await loadLocale(currentLanguage);
      this.applyTranslations();

      // 言語切り替えセレクタの選択値を同期
      const select = document.getElementById('lang-select');
      if (select) {
        select.value = currentLanguage;
      }
    },

    /**
     * 現在の言語を取得
     * @returns {string}
     */
    getLanguage() {
      return currentLanguage;
    },

    /**
     * 言語を切り替える
     * @param {string} lang
     * @returns {Promise<void>}
     */
    async setLanguage(lang) {
      if (!SUPPORTED_LANGUAGES.includes(lang)) {
        console.warn(`[i18n] 未サポートの言語です: ${lang}`);
        return;
      }
      currentLanguage = lang;
      localStorage.setItem('bct15x_language', lang);
      await loadLocale(lang);

      // DOM内の翻訳を自動更新
      this.applyTranslations();

      const select = document.getElementById('lang-select');
      if (select) {
        select.value = lang;
      }

      // 言語変更カスタムイベントを発火
      window.dispatchEvent(
        new CustomEvent('languageChanged', {
          detail: { language: lang },
        })
      );
    },

    /**
     * キーから翻訳文字列を取得する
     * @param {string} key - 例: "editor.toolbar.download"
     * @param {Object} [params] - 置換パラメータ (例: { count: 5 })
     * @returns {string}
     */
    t(key, params = {}) {
      const currentDict = translationsCache[currentLanguage];
      const defaultDict = translationsCache[DEFAULT_LANGUAGE];

      let text = resolveKey(currentDict, key);
      if (text === null && defaultDict) {
        text = resolveKey(defaultDict, key);
      }
      if (text === null) {
        return key; // キーをそのまま返す
      }

      // パラメータ置換 ({name} -> params.name)
      if (params && typeof params === 'object') {
        text = text.replace(/\{(\w+)\}/g, (match, paramName) => {
          return params[paramName] !== undefined ? params[paramName] : match;
        });
      }

      return text;
    },

    /**
     * DOM要素内の [data-i18n] 属性を持つ全要素に翻訳を適用する
     * @param {HTMLElement} [rootElement=document]
     */
    applyTranslations(rootElement = document) {
      // テキスト置換
      rootElement.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key) {
          el.innerText = this.t(key);
        }
      });

      // HTML置換 (太字やコード等のタグを含む場合)
      rootElement.querySelectorAll('[data-i18n-html]').forEach((el) => {
        const key = el.getAttribute('data-i18n-html');
        if (key) {
          el.innerHTML = this.t(key);
        }
      });

      // placeholder置換
      rootElement.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
          el.setAttribute('placeholder', this.t(key));
        }
      });

      // title (ツールチップ) 置換
      rootElement.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
          el.setAttribute('title', this.t(key));
        }
      });
    },
  };
})();
