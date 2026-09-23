# 実装計画: 低遅延音声ストリーミング (WebSocket + Web Audio API)

現在の HTTP MP3 ストリーミング（ブラウザの `<audio>` 要素による 2〜5 秒以上の遅延）を刷新し、**WebSocket 経由での raw PCM 配信 ＋ Web Audio API による低遅延再生（100〜300ms）** に移行します。これにより、インターフェースのチャンネル・周波数表示の切り替わりと、スピーカーから聞こえる音声をほぼ完全に同期させます。

---

## ユーザー確認事項 (User Review Required)

> [!NOTE]
> - **音声データ形式**: SoX から出力される音声を `raw PCM (16kHz 16bit LE mono)` に変更します。毎秒の転送量は約 32 KB/s と非常に軽量です。
> - **録音機能（MP3）との両立**: 録音保存時は、Node.js 側で SoX の MP3 エンコードパイプ（`sox -t raw ... -t mp3 ...`）を介して保存するため、既存の MP3 録音ファイル形式やメタデータ処理はそのまま維持されます。
> - **エンドポイント分離**: 画面の制御・ステータス用（`/ws`）と、音声ストリーミング用（`/ws/audio`）を分離し、音声の開始・停止がスキャナーの操作性や通信に影響を与えない設計とします。

---

## 変更内容の概要

### 1. サーバー側: `AudioStreamer` の改修
- **SoX コマンド引数の変更**:
  - `sox -t alsa <device> --buffer 1024 -t raw -c 1 -r 16000 -b 16 -e signed-integer -`
  - `--buffer 1024` により、SoX 内部のバッファ蓄積を最小化。
  - 出力を MP3 ではなく raw PCM に変更。
- **録音パイプの更新**:
  - 録音開始時（`startRecordingPipe`）に、PCM を入力として MP3 を出力する SoX 子プロセス（`sox -t raw -r 16000 -c 1 -b 16 -e signed-integer - -t mp3 -C <bitrate> <filePath>`）を起動し、ストリームをパイプ。
  - 録音停止時は stdin を close し、安全にフラッシュ完了を待つ。
- **モックモードの更新**:
  - PCM 用の無音バッファ（20ms〜30msごとのゼロバイト列）を生成して配信。

### 2. サーバー側: 音声専用 WebSocket ハンドラの実装
- **新規ファイル**: `src/api/audioWsHandler.js`
  - `/ws/audio` パスで WebSocket 接続を処理。
  - クライアントが接続したら、`audioStreamer.addClient()` に相当するリスナー登録を行い、PCM チャンク（バイナリフレーム）をブロードキャスト。
  - リスナーがゼロになったら SoX プロセスを停止（録音中でない場合）。
  - リスナーが接続したら SoX プロセスを開始。
  - 認証が有効な場合はトークン検証（クエリパラメータまたは初期メッセージ）に対応。

### 3. フロントエンド: Web Audio API プレーヤーの実装
- **新規または改修**: `public/js/audioPlayer.js` / `public/js/scannerDisplay.js`
  - `HTMLAudioElement`（`<audio>` タグ）の直接再生を廃止。
  - **Web Audio API (`AudioContext`)**:
    - ユーザーの「ライブ音声」ボタン押下時に `AudioContext` を初期化・`resume()`（ブラウザの Autoplay ポリシー対策）。
    - 音量調整用 `GainNode` を接続（既存の音量スライダーと連動）。
  - **WebSocket 受信と再生キュー**:
    - `/ws/audio` に接続し、バイナリメッセージ（`ArrayBuffer`）を受信。
    - Int16Array を Float32Array に変換して `AudioBuffer` を作成。
    - `nextPlayTime` を管理し、途切れのないスケジュール再生を実施。
  - **リアルタイム追従（超低遅延維持ロジック）**:
    - キューが 300ms 以上溜まった場合（一時的な通信遅れやタブの非アクティブ時など）、古いバッファを破棄して最新位置（`audioContext.currentTime + 0.05`）へジャンプ。
    - これにより、何時間再生しても遅延が一切累積しない。
  - **UI 状態の維持**:
    - 既存の「ライブ音声」ボタンの ON/OFF、ボリュームスライダー、ミュート機能とシームレスに連携。

---

## 変更対象ファイル

### バックエンド
- `[MODIFY] src/audio/audioStreamer.js`: raw PCM 出力、低バッファ引数、録音時の SoX MP3 エンコードパイプ化、モックPCM対応
- `[NEW] src/api/audioWsHandler.js`: `/ws/audio` WebSocket サーバー実装、PCMバイナリブロードキャスト
- `[MODIFY] src/server.js`: `audioWsHandler` の初期化とライフサイクル管理
- `[MODIFY] src/config/defaultConfig.js`: 音声ストリーミング設定の整理・確認

### フロントエンド
- `[NEW] public/js/audioPlayer.js`: Web Audio API を用いた PCM ストリーミング再生クラス
- `[MODIFY] public/js/scannerDisplay.js`: 新しい `AudioPlayer` との統合、HTMLAudioElement からの置き換え
- `[MODIFY] public/index.html`: `audioPlayer.js` のスクリプトタグ追加（必要に応じて）

---

## 検証計画 (Verification Plan)

### 自動テスト / ユニット動作検証
- Node.js 環境での `AudioStreamer` の PCM 出力および録音パイプの動作確認
- `node src/server.js`（モックモードおよび実機設定）での起動確認とエラーログの有無

### 手動検証
1. **WebSocket 音声ストリーミング接続**:
   - ブラウザで Web UI を開き、「ライブ音声」ボタンをクリックして音声が即座に再生されることを確認。
   - ブラウザの開発者ツール（ネットワーク/コンソール）で `/ws/audio` のバイナリ通信を確認。
2. **遅延・同期の確認**:
   - スキャナーがチャンネルを受信し、画面にチャンネル名が表示されたタイミングと、音声が流れ始めるタイミングのズレを確認（目視・聴感でコンマ数秒以内）。
   - 音声が鳴っている最中に別のチャンネルに切り替わった際、古い音声が引きずられずに即座に切り替わることを確認。
3. **録音機能の正常性**:
   - 受信時に自動録音されたファイル（MP3）が正常に生成され、再生できることを確認。
