# 多言語化 (i18n) サポート 実装完了ウォークスルー

## 概要
BCT15X リモートスキャナー Web UI に、将来の言語追加が極めて容易な**多言語化（i18n）アーキテクチャ**を実装しました。
日本語（ja）および英語（en）を標準サポートし、ヘッダーのドロップダウンから画面リロードなしで即時に言語を切り替えられます。また、ブラウザの言語自動検出およびユーザー選択言語のローカル永続化に対応しています。

---

## 主な実装内容

### 1. 外部辞書ファイルの分離 (JSON)
- [ja.json](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/locales/ja.json): 日本語辞書
- [en.json](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/locales/en.json): 英語辞書
- **言語の追加方法**:
  将来新しい言語（例: ドイツ語 `de.json`、フランス語 `fr.json` 等）を対応させたい場合、`public/locales/` に新しいJSONファイルを追加し、`SUPPORTED_LANGUAGES` にコードを追加するだけで自動的に対応可能です。

### 2. 軽量i18nマネージャーモジュール (Vanilla JS)
- [i18n.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/js/i18n.js)
  - **自動検出 & 永続化**: 初回は `navigator.language` を自動判定、以降は `localStorage.getItem('bct15x_language')` に設定を保存。
  - **翻訳関数**: `i18n.t('editor.grid.channelCount', { count: 5 })` のようにネストされたキーやプレースホルダー置換に対応。
  - **DOM自動反映**:
    - `data-i18n="キー"`: テキスト内容（`innerText`）を置換
    - `data-i18n-html="キー"`: HTML内容（タグを含む説明文など）を置換
    - `data-i18n-placeholder="キー"`: 入力欄のプレースホルダーを置換
    - `data-i18n-title="キー"`: ツールチップを置換
  - **カスタムイベント**: 言語変更時に `window.dispatchEvent(new CustomEvent('languageChanged'))` を発火し、各画面部品が連動して再描画。

### 3. UIへの組み込み
- [index.html](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/index.html):
  - ヘッダー右上に言語選択ドロップダウン（🇯🇵 日本語 / 🇺🇸 English）を配置。
  - スキャナーパネル、コントロールパネル、受信ログ、録音ファイル、エディタツールバー、モーダルなどの各要素に `data-i18n` 属性を付与。
- [index.css](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/css/index.css):
  - ダークサイバーテーマに調和するスタイリッシュな言語セレクタ（`.lang-selector`, `.lang-dropdown`）を追加。
- [app.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/js/app.js) & [memoryEditor.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/js/memoryEditor.js):
  - 起動時の初期化連携と、言語切り替えイベントに応じた動的メッセージ（統計テキスト、ボタン表記、確認ダイアログ等）の多言語化。

---

## 画面での動作確認方法

1. 画面右上の言語セレクタ（**🇯🇵 日本語** / **🇺🇸 English**）をクリックして「English」に切り替えます。
2. 画面全体（ヘッダー、スキャナーステータス、コントロール、受信ログ、エディタ画面の全ボタンやテーブル見出し）が一瞬で英語表記に切り替わることを確認できます。
3. ブラウザをリロードしても、選択した言語設定が保持されます。
