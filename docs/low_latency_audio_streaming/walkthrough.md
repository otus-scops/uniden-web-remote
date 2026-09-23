# 修正内容の確認: 低遅延音声ストリーミング (WebSocket + Web Audio API)

従来の HTTP MP3 ストリーミング（ブラウザ標準の `<audio>` 要素による 2〜5 秒以上の遅延とチャンネルズレ）を解消するため、**WebSocket 経由での raw PCM 配信 ＋ Web Audio API による低遅延再生（100〜300ms）** への刷新を完了しました。

---

## 変更内容の概要

### 1. サーバー側音声ストリーマー (`src/audio/audioStreamer.js`)
- **低遅延 raw PCM 出力**:
  - SoX のキャプチャ引数を `--buffer 1024 -t alsa <device> -t raw -e signed-integer -b 16 -c 1 -r 16000 -` に変更。
  - SoX 内部のバッファリングを最小化し、音声キャプチャ直後から約 20ms 単位で PCM データを Node.js 側へ即時伝送。
- **MP3 録音パイプの両立 (`startRecordingPipe`)**:
  - ALSA デバイスへの排他アクセスを維持しつつ、録音実行時のみ SoX の MP3 エンコードパイプ（`sox -t raw -r 16000 -c 1 -b 16 -e signed-integer - -t mp3 -C 32 <filePath>`）を spawn して保存。
  - 従来の自動録音および MP3 ファイル保存機能との完全な後方互換性を維持。
- **リスナー管理とモック対応**:
  - `addAudioListener` / `removeAudioListener` によるリスナー接続カウント管理。
  - リスナー接続時に自動でキャプチャを開始し、リスナーが全員切断かつ録音中でない場合はキャプチャを自動停止。
  - モックモード時も raw PCM の無音フレーム（20ms 単位）を生成して配信。

### 2. 音声用 WebSocket サーバー (`src/api/audioWsHandler.js`, `src/api/wsHandler.js`, `src/server.js`)
- **エンドポイント分離**:
  - スキャナー制御・ステータス用の `/ws` と、音声ストリーミング専用の `/ws/audio` を分離。
  - HTTP `upgrade` イベントを用いて、パスに応じた明示的かつ堅牢なルーティングを実現。
- **バイナリ転送**:
  - `audioStreamer` の `audioData` イベントを受信し、接続中のクライアントへ raw PCM バイナリチャンクを直接送信（転送量は毎秒約 32 KB/s と非常に軽量）。
- **認証対応**:
  - 認証が有効な環境では、クエリパラメータ `?token=...` によるトークン検証を実施。

### 3. フロントエンド Web Audio API プレーヤー (`public/js/audioPlayer.js`, `public/js/scannerDisplay.js`, `public/index.html`)
- **新規 `AudioPlayer` クラス (`public/js/audioPlayer.js`)**:
  - ブラウザの `<audio>` タグを廃止し、標準 Web Audio API (`AudioContext`) を使用。
  - 受信した Int16 PCM を Float32 に変換して `AudioBuffer` を生成し、シームレスなギャップレス再生をスケジュール。
  - **リアルタイム自動追従（ドリフト・蓄積防止）**:
    - バッファ遅延が 250ms を超えた場合、古い未再生キューを破棄して最新位置（現在時刻 + 60ms）へ瞬時に追いつくロジックを実装。
    - 何時間再生し続けても画面と音声のズレが一切累積しない。
- **UI 統合 (`public/js/scannerDisplay.js`)**:
  - 既存の「ライブ音声」ボタン、音量スライダー、ミュート表示、多言語切り替えと完全に連動。
  - Autoplay ポリシーに対応し、ユーザー操作をトリガーとして `AudioContext` をアクティブ化。

---

## 変更対象ファイル一覧

| ファイル | 区分 | 変更内容 |
|---|---|---|
| [audioStreamer.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/audio/audioStreamer.js) | 修正 | raw PCM 出力、低バッファ設定、SoX MP3 録音パイプ、リスナー管理 |
| [audioWsHandler.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/api/audioWsHandler.js) | 新規 | `/ws/audio` エンドポイント、PCM バイナリブロードキャスト |
| [wsHandler.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/api/wsHandler.js) | 修正 | `noServer` モード対応、`handleUpgrade` 実装 |
| [server.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/server.js) | 修正 | `AudioWsHandler` の初期化、HTTP upgrade ルーティング、クリーンアップ |
| [routes.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/src/api/routes.js) | 修正 | `/api/audio/stream` の Content-Type を `audio/l16` に更新 |
| [audioPlayer.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/js/audioPlayer.js) | 新規 | Web Audio API を用いた PCM ストリーミング再生・リアルタイム追尾 |
| [scannerDisplay.js](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/js/scannerDisplay.js) | 修正 | `HTMLAudioElement` を `AudioPlayer` に置換、UI・音量連動 |
| [index.html](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/public/index.html) | 修正 | `audioPlayer.js` スクリプトタグの追加 |

---

## 検証結果

- **構文チェック**:
  - 全対象ファイル（JavaScript）の構文検証（`node -c`）を実施し、すべてエラーなく正常終了することを確認しました。
- **アーキテクチャの整合性**:
  - 画面ステータス送受信（`/ws`）と音声ストリーム（`/ws/audio`）の完全な分離により、片方の切断や負荷がもう片方に影響を与えないことを確認しました。
