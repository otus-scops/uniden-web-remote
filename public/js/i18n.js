/**
 * @fileoverview Lightweight Internationalization (i18n) Module (Vanilla JS)
 * @description Dynamic JSON locale loader, language switcher, DOM attribute replacer, parameter interpolation
 */

const i18n = (function () {
  /** @type {string} Default language */
  const DEFAULT_LANGUAGE = 'ja';

  /** @type {string[]} Supported languages */
  const SUPPORTED_LANGUAGES = ['ja', 'en'];

  /** @type {string} Current active language code */
  let currentLanguage = DEFAULT_LANGUAGE;

  /** @type {Object<string, Object>} Loaded translation dictionary cache */
  const translationsCache = {};

  /**
   * Determine preferred language from localStorage or browser settings
   * @returns {string} Language code
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
   * Load JSON dictionary for specified language
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
      console.error(`[i18n] Failed to fetch locale dictionary: ${lang}`, err);
      // Fallback
      if (lang !== DEFAULT_LANGUAGE && translationsCache[DEFAULT_LANGUAGE]) {
        return translationsCache[DEFAULT_LANGUAGE];
      }
      return {};
    }
  }

  /**
   * Resolve nested dictionary string from dot-separated key path
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
     * Initialize i18n module
     * @returns {Promise<void>}
     */
    async init() {
      currentLanguage = detectLanguage();
      await loadLocale(currentLanguage);
      this.applyTranslations();

      // Synchronize language selector dropdown
      const select = document.getElementById('lang-select');
      if (select) {
        select.value = currentLanguage;
      }
    },

    /**
     * Get current active language code
     * @returns {string}
     */
    getLanguage() {
      return currentLanguage;
    },

    /**
     * Switch language and update UI
     * @param {string} lang
     * @returns {Promise<void>}
     */
    async setLanguage(lang) {
      if (!SUPPORTED_LANGUAGES.includes(lang)) {
        console.warn(`[i18n] Unsupported language code: ${lang}`);
        return;
      }
      currentLanguage = lang;
      localStorage.setItem('bct15x_language', lang);
      await loadLocale(lang);

      // Automatically update translations across DOM
      this.applyTranslations();

      const select = document.getElementById('lang-select');
      if (select) {
        select.value = lang;
      }

      // Dispatch custom language changed event
      window.dispatchEvent(
        new CustomEvent('languageChanged', {
          detail: { language: lang },
        })
      );
    },

    /**
     * Translate key into localized string with parameter substitution
     * @param {string} key - e.g. "editor.toolbar.download"
     * @param {Object} [params] - Replacement parameters (e.g. { count: 5 })
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
        return key; // Return raw key on missing translation
      }

      // Parameter replacement ({name} -> params.name)
      if (params && typeof params === 'object') {
        text = text.replace(/\{(\w+)\}/g, (match, paramName) => {
          return params[paramName] !== undefined ? params[paramName] : match;
        });
      }

      return text;
    },

    /**
     * Apply translations to all DOM elements with [data-i18n*] attributes
     * @param {HTMLElement} [rootElement=document]
     */
    applyTranslations(rootElement = document) {
      // Text replacement
      rootElement.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key) {
          el.innerText = this.t(key);
        }
      });

      // HTML replacement (for rich text formatting like bold or code tags)
      rootElement.querySelectorAll('[data-i18n-html]').forEach((el) => {
        const key = el.getAttribute('data-i18n-html');
        if (key) {
          el.innerHTML = this.t(key);
        }
      });

      // Placeholder attribute replacement
      rootElement.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
          el.setAttribute('placeholder', this.t(key));
        }
      });

      // Title attribute replacement (tooltips)
      rootElement.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
          el.setAttribute('title', this.t(key));
        }
      });
    },
  };
})();
