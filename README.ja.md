# Uniden Web Remote & Memory Manager (`uniden-web-remote`)

[English](README.md) | [日本語]

Uniden スキャナー（BCT15X および互換 DMA 機種）を USB シリアル経由でリモート制御し、受信音声をリアルタイム配信・自動録音できる Web アプリケーション。
Docker 上で軽快に動作し、ブラウザからスキャナーの操作や、**FreeSCAN を代替する本格的なスプレッドシート型メモリプログラミング**が行えます。
多言語対応（日本語・English）を標準搭載しています。

### 📻 対応機種
- **動作検証済み**: **Uniden Bearcat BCT15X**
- **プロトコル互換性**: Uniden DMA（Dynamic Memory Architecture）シリアルプロトコルに準拠して設計されています。同系統のコマンド体系を持つ **BCD996XT**, **BCD996P2**, **BCD396XT**, **BCD325P2**, **BC346XT** 等でも同様に動作、または少数の調整で対応可能です。（コミュニティからの動作報告やプルリクエストを歓迎します！）

---

## 🌟 主な機能 (Community Edition / オープンソース)

- 📡 **リアルタイムスキャナー表示**: 周波数/TGID、アルファタグ（システム/グループ/チャンネル名）、変調方式、CTCSS/DCS トーン、RSSI 信号強度メーター
- 🔊 **LIVE 音声ストリーミング配信**: ブラウザ上で直接、超低遅延の受信音声を再生可能
- 🎛️ **フルリモートコントロール**: スキャン、ホールド、メニュー、キーパッド、ボリューム/スケルチの直感的な操作
- 📝 **FreeSCAN 代替 本格メモリエディタ**:
  - BCT15X 実機 DMA プロトコル（リンクリスト走査）による**全メモリの一括読み出し・書き込み**
  - **スプレッドシート型グリッド編集**: 周波数、変調、トーン、アッテネータ、優先チャンネル等のインライン編集
  - **Excel / テキスト一括貼り付け**: 表計算ソフトからコピーした複数チャンネルを一瞬でインポート
  - **安全バックアップ機能**: 実機への書き込み時に自動でローカルバックアップ JSON を作成、過去履歴から復元可能
  - CSV / JSON のエクスポート＆インポート対応
- 🎙️ **自動録音**: 信号受信時に自動で MP3 録音、ヒットごとにファイル分割・ブラウザ再生・ダウンロード
- 📋 **受信ログ**: 受信時刻、周波数、システム名等の履歴記録と CSV 出力
- 🌐 **多言語対応 (i18n)**: 🇯🇵 日本語 / 🇺🇸 English をワンクリックでシームレスに切り替え（将来の言語追加も JSON 1枚で可能）
- 🖥️ **モックモード**: 実機なしでの UI 開発・デモ体験

---

## 🚀 クイックスタート

### 1. ハードウェア接続

- BCT15X フロント端子 ──(USBシリアルケーブル)──> PC/ホスト Linux
- BCT15X ヘッドホン端子 ──(オーディオケーブル)──> PC ライン入力または USB オーディオデバイス

```bash
# USBシリアルデバイスの確認
ls /dev/ttyUSB*

# 録音デバイスの確認
arecord -l
```

### 2. 起動 (Docker Compose)

```bash
# リポジトリのディレクトリに移動
cd "Remote for docker"

# ビルド＆起動
docker compose up -d --build

# ログ確認
docker compose logs -f scanner
```

ブラウザで `http://localhost:3000` を開きます。

---

## ⚙️ 環境変数設定 (`docker-compose.yml`)

| 変数名 | デフォルト値 | 説明 |
|:---|:---|:---|
| `SERIAL_PORT` | `/dev/ttyUSB0` | BCT15X シリアルポートパス |
| `SERIAL_BAUD` | `115200` | 通信速度 (bps) |
| `AUDIO_DEVICE` | `plughw:1,0` | ALSA 録音デバイス名 (例: `plughw:1,0`) |
| `AUDIO_FORMAT` | `mp3` | 録音フォーマット (`mp3`) |
| `AUDIO_SAMPLE_RATE` | `22050` | サンプリングレート (Hz) |
| `AUDIO_BITRATE` | `64` | MP3 ビットレート (kbps) |
| `AUTO_RECORD` | `true` | 自動録音の有効化 |
| `FILENAME_TEMPLATE`| `{date}_{time}_{freq}_{system}_{channel}` | 録音ファイル名テンプレート |
| `MOCK_MODE` | `false` | 実機なしテストモード (`true`/`false`) |
| `TZ` | `Asia/Tokyo` | タイムゾーン |

---

## 📄 ライセンス

本ソフトウェアは **Apache License 2.0** の下で公開されています。
詳細は [LICENSE](LICENSE) ファイルをご確認ください。
