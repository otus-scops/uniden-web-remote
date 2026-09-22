# 多言語化 (i18n) サポート 実装計画

## 概要
BCT15X リモートスキャナー Web UI に多言語化（i18n: Internationalization）基盤を導入します。
初期対応言語として「日本語 (ja)」および「英語 (en)」をサポートし、将来的に新しい言語（フランス語、ドイツ語、スペイン語等）のJSON辞書ファイルを追加するだけで簡単に言語拡張できる設計とします。

---

## 設計アーキテクチャ

### 1. 辞書構成
```
public/
  └── locales/
        ├── ja.json   ← 日本語辞書
        └── en.json   ← 英語辞書
```

キーの階層構造例:
- `header.*`: ヘッダー、接続ステータス、エディタ切替
- `scanner.*`: 周波数表示、シグナル、再生ボタン
- `keypad.*`: スキャナー操作ボタン
- `editor.*`: ツールバー、ツリー、スプレッドシート見出し、アクション
- `recordings.*`: 録音リスト、再生、ダウンロード
- `log.*`: 受信ログテーブル、フィルタ、CSVエクスポート

### 2. i18n エンジン (`public/js/i18n.js`)
- `init()`: `localStorage` の保存言語、またはブラウザの `navigator.language` から初期言語を決定しロード。
- `t(key, params)`: キー指定での翻訳文字列取得。`{name}` のようなパラメータ置換に対応。
- `setLanguage(lang)`: 言語切り替え、辞書ロード、UIへの即時自動適用。
- `applyTranslations(root)`: `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` を持つDOM要素を一括更新。

---

## 変更対象ファイル

1. [NEW] `public/locales/ja.json`: 日本語辞書
2. [NEW] `public/locales/en.json`: 英語辞書
3. [NEW] `public/js/i18n.js`: i18n管理モジュール
4. [MODIFY] `public/index.html`: 言語選択セレクタ追加、`data-i18n` 属性付与、`i18n.js` スクリプトタグ追加
5. [MODIFY] `public/css/index.css`: 言語セレクタのスタイリング
6. [MODIFY] `public/js/app.js`: 初期化フローへの `i18n.init()` 組み込み
7. [MODIFY] `public/js/memoryEditor.js`: 動的ラベルの国際化対応
