# オープンコアアーキテクチャ再編 実装計画

## 概要
BCT15X リモートスキャナーを GitHub で公開可能な **オープンコア（Open Core）モデル** へ整理・再編します。

- **コア機能（オープンソース / Apache 2.0）**:
  - Web UIからのリモート操作、スキャナー液晶画面再現
  - LIVE音声ストリーミング配信
  - FreeSCAN代替の本格スプレッドシート型メモリエディタ（実機DMA一括読み書き、Excelコピペ、CSV/JSON入出力）
  - ローカル録音（mp3保存・Webブラウザ再生・ダウンロード）
  - 多言語対応（日本語・英語）

- **Pro機能（拡張モジュール / 将来の有料・プレミアム向け）**:
  - rcloneによるクラウドストレージ（Google Drive / AWS S3 / Dropbox等）への自動同期
  - サイドカーコンテナ（`docker-compose.pro.yml`）として綺麗に分離

---

## 変更対象ファイル

1. [MODIFY] `Dockerfile`: rclone の個別 deb インストールを除去し、コンテナを軽量化。
2. [MODIFY] `docker-compose.yml`: オープンソース標準の軽量な構成にクリーンアップ。
3. [NEW] `docker-compose.pro.yml`: Pro用クラウド同期サイドカーコンテナ定義。
4. [NEW] `LICENSE`: Apache License 2.0 の正式ライセンスファイル。
5. [MODIFY] `README.md`: プロジェクト説明、機能切り分け、Apache 2.0 表記。
