# タスクリスト: 低遅延音声ストリーミング (WebSocket + Web Audio API)

## 進行状況
- [x] 1. 設計と計画立案
  - [x] 音声伝送方式の選定 (PCM 16bit 16kHz Mono)
  - [x] 実装計画ドキュメント (`implementation_plan.md`) の作成・承認
- [x] 2. サーバー側音声ストリーマーの改修 (`src/audio/audioStreamer.js`)
  - [x] SoX キャプチャ出力を raw PCM (16kHz 16bit LE mono, 低バッファ) に変更
  - [x] モックモードでの PCM 無音フレーム生成処理の実装
  - [x] 録音用パイプ (`AudioRecorder`) への SoX MP3 エンコードパイプの組み込み
  - [x] PCM 音声チャンクのブロードキャスト機構の整備
- [x] 3. 音声用 WebSocket サーバーの実装 (`src/api/audioWsHandler.js` / `src/server.js`)
  - [x] `/ws/audio` エンドポイントの新設
  - [x] 音声リスナーの接続・切断ライフサイクル管理 (リスナー0人でSoX停止、1人以上でSoX開始)
  - [x] 認証 (Auth) が有効な場合のトークン検証対応
- [x] 4. フロントエンド Web Audio API プレーヤーの実装 (`public/js/audioPlayer.js` / `public/js/scannerDisplay.js`)
  - [x] Web Audio API (`AudioContext`, `GainNode`) の初期化とユーザー操作連携 (Autoplayポリシー対策)
  - [x] WebSocket (`/ws/audio`) 経由での PCM バイナリ受信と Float32 変換
  - [x] ギャップレススケジュール再生とジッターバッファ (50〜150ms) の管理
  - [x] リアルタイム追尾ロジック (遅延蓄積時の最新位置ジャンプ)
  - [x] ボリューム調整および UI 連携 (再生・停止・再試行)
- [x] 5. 動作確認と検証
  - [x] 構文チェックおよびモジュール整合性検証
  - [x] 画面のチャンネル表示更新と音声の同期精度の設計確認
  - [x] 録音機能が正常に MP3 として保存される機構の確認
  - [x] Walkthrough ドキュメント (`walkthrough.md`) の作成
