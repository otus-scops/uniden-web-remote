/**
 * @fileoverview 実行時設定（ボリューム、スケルチ、各種設定）の永続化管理モジュール
 * @description 再起動後も直前のVOL/SQ設定やユーザー変更設定を保持するためのJSON読み書きヘルパー
 */

const fs = require('fs');
const path = require('path');

/**
 * 永続化設定ファイルのパスを取得
 * @returns {string} 設定ファイルパス
 */
function getConfigFilePath() {
  const configDir = process.env.CONFIG_DIR || path.join(__dirname, '../../config');
  return path.join(configDir, 'runtime-settings.json');
}

/**
 * 永続化された実行時設定をロードする
 * @returns {Object} 保存されていた設定オブジェクト（存在しない場合は空オブジェクト）
 */
function loadRuntimeConfig() {
  try {
    const filePath = getConfigFilePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[RuntimeConfig] ⚠️ 設定ファイルの読み込みに失敗しました:', err.message);
  }
  return {};
}

/**
 * 実行時設定を永続化ファイルに保存する
 * @param {Object} updates - 更新する設定項目
 * @returns {Promise<void>}
 */
async function saveRuntimeConfig(updates) {
  try {
    const filePath = getConfigFilePath();
    const dirPath = path.dirname(filePath);

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const current = loadRuntimeConfig();
    const merged = { ...current, ...updates, updatedAt: new Date().toISOString() };
    await fs.promises.writeFile(filePath, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err) {
    console.error('[RuntimeConfig] ❌ 設定ファイルの保存に失敗しました:', err.message);
  }
}

module.exports = {
  loadRuntimeConfig,
  saveRuntimeConfig,
  getConfigFilePath,
};
