# オープンコアアーキテクチャ再編 完了ウォークスルー

## 概要
BCT15X リモートスキャナーを、コミュニティへのオープンソース公開（GitHub）と将来のフリーミアム展開（Pro機能有料化）の両立が可能な **オープンコア（Open Core）アーキテクチャ** に再構成しました。

---

## 主な変更点と再編内容

### 1. コアコンテナの軽量化（無料版 / コミュニティ版）
- [Dockerfile](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/Dockerfile):
  - 個別 deb パッケージをダウンロードしてビルドしていた `rclone` のインストール処理を削除しました。
  - イメージサイズが約 50MB 削減され、Docker ビルド時間が大幅に短縮されました。
- [docker-compose.yml](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/docker-compose.yml):
  - 無料版の標準構成としてクリーンアップしました。
  - 音声デバイス設定も、ALSAフォーマット自動変換に対応した推奨値 `plughw:1,0` に統一されています。

### 2. クラウド自動同期の Pro 拡張化（サイドカーコンテナ）
- [docker-compose.pro.yml](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/docker-compose.pro.yml):
  - クラウド同期機能を、公式の軽量イメージ `rclone/rclone:latest` を利用した独立サイドカーコンテナ `cloud-sync` として定義しました。
  - アプリ本体のソースコードを改変することなく、以下のコマンドを打つだけで Pro 機能（Google Drive / S3 / Dropbox等への自動同期）を有効化できます：
    ```bash
    docker compose -f docker-compose.yml -f docker-compose.pro.yml up -d
    ```

### 3. ライセンスおよび GitHub 公開ドキュメントの整備
- [LICENSE](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/LICENSE):
  - ご希望の **Apache License 2.0** を正式に配置しました。特許リスクや商標が保護され、オープンソースとして安心して公開できます。
- [README.md](file:///m:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Uniden/Remote%20for%20docker/README.md):
  - 無料版の豊富な機能（リモート操作、LIVE音声配信、FreeSCAN代替スプレッドシートエディタ、多言語対応 🇯🇵/🇺🇸）と、Pro 拡張機能（クラウド自動同期）を明確に分けて解説しました。

---

## 今後のフリーミアム展開に向けたメリット

1. **コミュニティへのアピール**:
   - 無料版単体で完成された機能（スキャナー制御＋音声配信＋FreeSCAN代替エディタ＋多言語対応）を持っているため、GitHub でスターや評価を広く獲得できます。
2. **安全な Pro 機能の保護**:
   - クラウド同期や将来の Pro 機能（AI 文字起こし、Discord 通知等）がサイドカーコンテナや別パッケージとして切り離されているため、有料機能のコードが無料版と混ざらず安全に管理・配布できます。
