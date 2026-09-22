FROM node:20-slim

# 必要パッケージのインストール
# sox: 音声録音・処理
# libsox-fmt-mp3: SOX MP3エンコードサポート
# alsa-utils: ALSA音声デバイス操作 (arecord, aplay等)
# rclone: Google Drive同期用（オプション）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    sox \
    libsox-fmt-mp3 \
    alsa-utils \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリ
WORKDIR /app

# アプリケーションコードのコピー
COPY . .

# ホスト側の node_modules を除去し、クリーンインストール
RUN rm -rf node_modules && npm install --omit=dev

# 録音ディレクトリの作成
RUN mkdir -p /app/recordings /app/config

# ポート公開
EXPOSE 3000

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/status || exit 1

# エントリポイント
CMD ["node", "src/server.js"]
