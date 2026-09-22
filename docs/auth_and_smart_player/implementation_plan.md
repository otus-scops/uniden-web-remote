# 実装計画書: 権限管理（リスナー/オペレーター）と録音スマート連続再生（フォルダ階層＆メタデータ対応）

## 目的
1. **権限管理（機能1）**: 家族・友人へのURL共有や外出先利用時を想定し、閲覧・視聴のみ可能な「リスナー (Listener)」と、スキャナー操作・メモリ編集が可能な「オペレーター (Operator)」のロール分離とアクセス保護を実現する。
2. **録音の高機能化（機能3）**: 
   - 編集機能側と整合させた **`{system}/{department}/{channel}/{date}_{time}_{freq}.mp3` のフォルダ階層管理**
   - 録音完了時に詳細情報を記録する **Sidecar JSON メタデータファイル (`.json`) の自動生成**
   - 受信したシステム・デパートメント・チャンネル等の多次元階層絞り込み
   - 特定期間（今日・直近24h・カスタム範囲）の高速抽出
   - 自動連続再生プレーヤー（Auto-Play Next、再生速度変更、スマホロック画面 MediaSession 操作対応）

---

## 提案される変更点

### 1. 権限管理 & アクセス認証 (Auth & Role System)

#### 設定 (`src/config/defaultConfig.js`)
- `auth`:
  - `enabled`: `false` (デフォルトは従来どおり認証不要、`AUTH_ENABLED=true` で有効化)
  - `adminPassword`: `ADMIN_PASSWORD` 環境変数（オペレーター用パスワード）
  - `listenerPassword`: `LISTENER_PASSWORD` 環境変数（リスナー用パスワード、空なら誰でもリスナー可能）
  - `sessionSecret`: 簡易トークン署名用シークレット

#### サーバー API & WebSocket 保護 (`src/api/authRoutes.js`, `src/server.js`, `src/api/wsHandler.js`)
- **新設エンドポイント**:
  - `POST /api/auth/login`: パスワード検証 ➔ JWT風の軽量Bearerトークンを返却
  - `GET /api/auth/status`: 現在の権限レベル (`anonymous`, `listener`, `operator`) の確認
  - `POST /api/auth/logout`: ログアウト
- **ミドルウェア保護**:
  - `requireOperator`: スキャナ操作 (`/api/command/*`)、メモリ書き換え (`/api/memory/*`)、録音削除 (`DELETE /recordings/*`) をオペレーターのみに制限
- **WebSocket 保護**:
  - WebSocket 経由のキー送信時などにオペレータートークンを検証

#### フロントエンド UI (`public/index.html`, `public/js/app.js`, `public/css/index.css`)
- **ヘッダーに権限状態バッジ & ログインボタン追加**:
  - `👑 Operator` または `🎧 Listener` バッジ
  - ログインボタン（クリックでモーダル表示 ➔ パスワード入力でオペレーターへ昇格）
- **リスナー時のUI制御**:
  - コントロールパネルの操作ボタンを非活性（disabled）化しツールチップ表示
  - メモリエディタの書き込み系操作を非活性化

---

### 2. 録音のフォルダ階層管理 & Sidecar メタデータ (`.json`)

#### フォルダ階層テンプレートの標準化 (`src/config/defaultConfig.js`, `src/audio/fileNamer.js`)
- デフォルトテンプレートを `{system}/{department}/{channel}/{date}_{time}_{freq}` に設定
  - 例: `Tokyo_Airband/Tokyo_App_Dep/Tokyo_TWR/2026-09-22_14-30-25_118.1000MHz.mp3`
- 未設定・空の場合のフォールバック（`Conventional/Default/...`）

#### Sidecar JSON メタデータ自動生成 (`src/audio/audioRecorder.js`)
- 録音完了（`stopRecording`）時に、MP3と同一パスに `.json` ファイルを出力
  - システム名、デパートメント名、チャンネル名、周波数、変調、トーン、受信開始・終了日時、再生時間秒数等
- 録音一覧取得（`getRecordings`）時に、`.json` があれば高速かつ正確に読み出し。存在しない古いファイルはファイル名・パスからフォールバック抽出。
- 録音ファイル削除（`deleteRecording`）時に、対になる `.json` も自動削除。

#### 録音メタデータ検索 & タグ抽出 API (`src/api/routes.js`)
- `GET /api/recordings`:
  - `system`, `department`, `channel`, `datePreset` (`today`, `yesterday`, `24h`, `7d`, `custom`), `minDuration` によるフィルタ
- `GET /api/recordings/tags`:
  - 録音済みの全システム・デパートメント・チャンネルの一意なリストを返却（UIのセレクト連動用）

---

### 3. 録音パネル UI & スマート連続再生プレイヤー (`public/index.html`, `public/js/recordingPanel.js`)

- **高度フィルターバー**:
  - 期間プリセットドロップダウン（すべて / 今日 / 昨日 / 直近24時間 / 過去7日 / カスタム）
  - システム・デパートメント・チャンネルの連動セレクター
  - 最小秒数フィルタ（ノイズ除外用）
- **スマート連続再生プレイヤー**:
  - **自動連続再生（Auto-Play Next）**: トラック終了（`ended`）時に、絞り込みリスト内の次トラックを自動再生
  - **再生順切り替え**: 「新しい順（降順）」⇄「古い順（時系列昇順）」
  - **再生速度コントロール**: `1.0x` / `1.25x` / `1.5x` / `2.0x`
  - **MediaSession API 連携**: ロック画面や通知欄・スマートウォッチにタイトル（チャンネル/周波数）・アーティスト（システム/デパート）を表示し、次へ/前へ/一時停止を操作可能

---

## 実装ステップ
1. **Phase 1: 権限管理 & アクセス認証 (Auth & Role)**
2. **Phase 2: 録音のフォルダ階層化・Sidecar JSON メタデータ・検索API拡張**
3. **Phase 3: 録音パネル UI改修・スマート連続再生プレイヤー & MediaSession API**
4. **Phase 4: 多言語辞書更新・PWAキャッシュ更新 (`v4`)・検証 & Walkthrough作成**
