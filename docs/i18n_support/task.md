# タスク: 多言語化 (i18n) サポート (日・英対応 & 拡張設計)

## タスク一覧

- [x] **フェーズ 1: 多言語化基盤の設計・辞書ファイルの作成**
  - [x] `public/locales/ja.json` の作成（日本語辞書）
  - [x] `public/locales/en.json` の作成（英語辞書）
  - [x] `public/js/i18n.js` の作成（言語ロード、DOM自動反映、変数展開、言語保存）

- [x] **フェーズ 2: UIへの言語切り替えコントロールとマークアップ対応**
  - [x] `public/index.html` に言語セレクター（🌐 🇯🇵 日本語 / 🇺🇸 English）を追加
  - [x] 主要要素に `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-html` 属性を付与
  - [x] `public/css/index.css` に言語セレクタースタイルを追加

- [x] **フェーズ 3: 各JSモジュールの動的メッセージ国際化**
  - [x] `public/js/app.js` の初期化と言語連携（`languageChanged` イベント）
  - [x] `public/js/scannerDisplay.js` のステータス・バッジ国際化
  - [x] `public/js/memoryEditor.js` のテーブル見出し、ボタン、モーダルメッセージ国際化

- [x] **フェーズ 4: 動作検証とウォークスルー作成**
  - [x] 辞書JSONの構文バリデーションテスト
  - [x] JavaScript構文チェックパス
  - [x] ドキュメント (`walkthrough.md`) の作成
