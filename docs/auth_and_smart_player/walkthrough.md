# ウォークスルー: 権限管理・スマート連続再生・ストレージ最適化の実装

## 1. 概要
本改修では、スキャナー運用における以下の主要な要件をすべて満たす堅牢なアーキテクチャとモダンなWeb機能を実装しました：

1. **アクセス認証 & 権限分離 (ロールベース制御)**
   - 閲覧・ストリーミング聴取・録音再生のみを行える「リスナー (Listener)」と、スキャナーのキー操作・コマンド送信・メモリ編集・録音削除を行える「オペレーター (Operator)」にロールを分離。
   - デフォルトは認証無効（`AUTH_ENABLED=false`）となっており、従来通りの利便性と完全な後方互換性を維持。
2. **ハイブリッド録音ストレージ & 外部削除の自動検知 (Reconciliation)**
   - フォルダ階層構造（`{system}/{department}/{channel}/{date}_{time}_{freq}.mp3`）と、同一フォルダ内の Sidecar JSON メタデータを自動生成。
   - Google Driveやエクスプローラー等でファイル側が手動削除された場合でも、一覧取得時に存在チェックを行い、インデックスから即座に自動パージ。404やゴースト表示が発生しない自己修復設計。
3. **自動リテンション (保持期間・ストレージ上限管理)**
   - 期限切れファイル（デフォルト30日）や指定容量（MB）を超過した古い録音を自動クリーンアップするバックグラウンドジョブを搭載。
4. **音質とファイルサイズの最適化**
   - 人の声・ラジオスキャナー通信帯域に特化した音声設定（32kbps Mono / 16000Hz）を適用し、聞き取りやすさを維持したままファイルサイズを約50%削減。常時録音のストレージ消費を最小限に抑制。
5. **スマート連続再生プレイヤー & 多次元フィルタリング**
   - 期間プリセット（今日・昨日・直近24時間・過去7日間）、システム・デパートメント・チャンネルの動的タグ絞り込み、最小秒数フィルタ。
   - 自動連続再生（Auto-Play Next）、再生順序（新しい順／時系列順）、再生速度変更（1.0x, 1.25x, 1.5x, 2.0x）。
   - スマートフォンのロック画面や通知領域から操作できる `MediaSession API` 連携。

---

## 2. 変更・新規作成ファイル一覧

| コンポーネント | ファイルパス | 変更内容 |
| :--- | :--- | :--- |
| **設定** | [src/config/defaultConfig.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/config/defaultConfig.js) | 音質最適化(32kbps/16kHz)、階層テンプレート、リテンション設定、認証設定の追加 |
| **認証基盤** | [src/api/authMiddleware.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/api/authMiddleware.js) | Node.js標準 `crypto` を用いたHMAC-SHA256トークン生成・検証、Expressミドルウェア |
| **認証API** | [src/api/authRoutes.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/api/authRoutes.js) | `/api/auth/login`, `/api/auth/status`, `/api/auth/logout` エンドポイント |
| **データストア** | [src/audio/recordingStore.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/audio/recordingStore.js) | インメモリ＋インデックスキャッシュ、外部削除Reconciliation、リテンション定期ジョブ、多次元検索 |
| **ファイル命名** | [src/audio/fileNamer.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/audio/fileNamer.js) | ディレクトリ階層時の空セグメントフォールバック処理 |
| **録音管理** | [src/audio/audioRecorder.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/audio/audioRecorder.js) | RecordingStore統合、Sidecar JSON生成、検索・削除・タグ抽出の委譲 |
| **サーバー & ルーティング** | [src/server.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/server.js), [src/api/routes.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/api/routes.js), [src/api/memoryRoutes.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/api/memoryRoutes.js), [src/api/wsHandler.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/api/wsHandler.js) | 認証ルートマウント、各操作のロール保護、録音タグAPI `/api/recordings/tags` |
| **フロントエンドUI** | [public/index.html](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/index.html) | ヘッダー権限バッジ・ログインボタン、認証モーダル、多次元フィルタバー、スマートプレイヤーバー |
| **スタイル** | [public/css/index.css](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/css/index.css) | 権限バッジ、認証モーダル、フィルタグリッド、スマートプレイヤーのスタイリング |
| **クライアントスクリプト** | [public/js/app.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/js/app.js), [public/js/controlPanel.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/js/controlPanel.js), [public/js/memoryEditor.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/js/memoryEditor.js), [public/js/recordingPanel.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/js/recordingPanel.js) | トークン管理、オペレーター権限ガード、スマート連続再生、タグ動的取得、MediaSession連携 |
| **多言語辞書** | [public/locales/ja.json](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/locales/ja.json), [public/locales/en.json](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/locales/en.json) | 認証・スマートプレイヤー・フィルタ用の多言語キー追加 |
| **Service Worker** | [public/sw.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/sw.js) | キャッシュバージョンを `v4` にインクリメント |

---

## 3. 検証結果

1. **構文チェック**
   - 変更・新規作成したすべての JavaScript ファイル (`node -c`) を実行し、構文エラー0件を確認。
2. **データストア単体検証 (`scratch/test_recording_store.js`)**
   - フォルダ階層スキャンおよび Sidecar JSON からのメタデータ読み取りが正確に機能することを確認。
   - `fs.unlinkSync` による外部手動削除シミュレーションを実施。クエリ実行時に即時検知され、インデックスから安全にパージされる（ゴースト化しない）ことを検証完了。
   - システム名やタグ抽出が正確に動作することを確認。
3. **認証トークン検証**
   - Node.js 標準 `crypto` による HMAC-SHA256 署名・検証テストを実施し、トークン生成とロール判定が正常にパスすることを確認。

---

## 4. 使い方と設定方法

### 認証の有効化（オプション）
認証を有効化する場合は、環境変数（または `.env`）に以下を設定します：
```bash
AUTH_ENABLED=true
OPERATOR_PASSWORD=your_strong_admin_password
LISTENER_PASSWORD=your_listener_password  # 未設定時は誰でもリスナーとして閲覧可能
```

### 録音リテンションの設定（オプション）
```bash
RETENTION_DAYS=30          # 30日経過した録音を自動削除（0で無効）
MAX_STORAGE_MB=10240       # 10GB超過時に古いファイルから自動削除（0で無効）
CLEANUP_INTERVAL_HOURS=12  # クリーンアップ実行間隔（時間）
```
