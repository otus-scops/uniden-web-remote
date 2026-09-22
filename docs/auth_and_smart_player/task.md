# タスク: 権限管理（リスナー/オペレーター）および録音スマート連続再生・ストレージ最適化の実装

## 1. 概要
- **アクセス認証 & 権限分離 (機能1)**:
  - リスナー（閲覧・視聴のみ）とオペレーター（スキャナー操作・メモリ編集・ファイル削除可能）のロール分離
  - セッション/トークン認証による API・WebSocket 操作保護（デフォルトは無効で完全後方互換）
  - フロントエンド UI での権限バッジおよびオペレーター昇格（ログイン）モーダル
- **録音の高度フィルタリング & スマート連続再生 (機能3)**:
  - システム・デパートメント・チャンネル・日付プリセット（今日/昨日/24h/7d）による多次元絞り込み
  - リスト内の自動連続再生（Auto-play Next）、再生順序切り替え（昇順/降順）、再生速度変更（1.0x〜2.0x）
  - スマホのロック画面・通知欄から操作できる MediaSession API 連携
- **ハイブリッド・ストレージ最適化 & 自動リテンション**:
  - フォルダ階層管理（`{system}/{department}/{channel}/{date}_{time}_{freq}.mp3`）
  - Sidecar JSON メタデータ生成
  - 外部手動ファイル削除の自動検知・整合性同期（Reconciliation）
  - リテンションポリシー（指定日数経過ファイルやストレージ上限超過の自動クリーンアップ）
  - スキャナー音声に特化した音質最適化（32kbps Mono / 16000Hz で容量約50%削減）

## 2. タスク一覧
- [x] **設計・計画**
  - [x] 実装計画書の作成 (`docs/auth_and_smart_player/implementation_plan.md`)
  - [x] ユーザーフィードバックの反映（手動削除対応、リテンション、音質最適化）
- [x] **Phase 1: 設定・音質・リテンションの最適化**
  - [x] 音質設定の最適化（32kbps mono / 16000Hz）
  - [x] 自動リテンション設定（`retentionDays: 30`, `maxStorageMb: 0`, `cleanupIntervalHours: 12`）
  - [x] 認証設定（`AUTH_ENABLED`, `OPERATOR_PASSWORD`, `LISTENER_PASSWORD`）
- [x] **Phase 2: データストア抽象層 & 整合性自動同期 (RecordingStore)**
  - [x] インメモリ＋キャッシュファイル永続化
  - [x] 外部手動削除の即時検知・パージ（Reconciliation）
  - [x] 自動リテンションクリーンアップ定期ジョブ
  - [x] 多次元フィルタリング & タグ一覧抽出
  - [x] AudioRecorder との統合
- [x] **Phase 3: 権限管理 & アクセス認証 (Auth & Role-Based Access)**
  - [x] HMAC-SHA256 軽量トークン生成・検証モジュール
  - [x] 認証ミドルウェア (`requireOperator`, `requireListener`)
  - [x] 認証 API (`/api/auth/login`, `/api/auth/status`, `/api/auth/logout`)
  - [x] 既存 REST API & WebSocket へのロール保護適用
- [x] **Phase 4: フロントエンド UI 改修**
  - [x] ヘッダーの権限バッジ & ログイン/ログアウトモーダル
  - [x] コントロールパネル & メモリ編集のオペレーター権限ガード
  - [x] 録音パネルの多次元フィルタ UI（期間、システム、デパート、チャンネル、最小秒数）
  - [x] スマート連続再生プレイヤーバー（Auto-Next、再生順、速度 1.0x〜2.0x）
  - [x] MediaSession API 連携（ロック画面操作）
- [x] **Phase 5: 多言語化・PWA・検証**
  - [x] `public/locales/ja.json`, `en.json` の辞書更新
  - [x] Service Worker キャッシュ更新 (`bct15x-remote-v4`)
  - [x] 全ファイル構文チェック & 単体テストスクリプトによる動作確認
  - [x] ウォークスルー文書作成 (`docs/auth_and_smart_player/walkthrough.md`)
