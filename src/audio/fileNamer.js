/**
 * @fileoverview ファイル命名ユーティリティ
 * @description 録音ファイルのテンプレートベース命名とサニタイズを行う。
 * テンプレートに `/` を含めることでディレクトリ階層を自動生成できる。
 */

const path = require('path');

/**
 * テンプレート文字列のプレースホルダーを実際の値で置換してファイル名（パス含む）を生成する。
 * テンプレートに `/` を含めると、ディレクトリ階層として処理される。
 *
 * @param {string} template - ファイル名テンプレート
 *   使用可能プレースホルダー:
 *   - {date} : 日付(YYYY-MM-DD)
 *   - {time} : 時刻(HH-mm-ss)
 *   - {datetime} : 日時(YYYY-MM-DD_HH-mm-ss)
 *   - {freq} : 周波数
 *   - {tgid} : トークグループID
 *   - {system} : システム名
 *   - {department} : デパートメント名
 *   - {channel} : チャンネル名
 *   - {modulation} : モジュレーション
 *   - {seq} : 連番
 *
 *   テンプレート例:
 *   - "{date}/{channel}/{time}_{freq}" → "2026-08-08/Dispatch/14-30-25_155.7000MHz.mp3"
 *   - "{date}_{time}_{freq}_{system}_{channel}" → "2026-08-08_14-30-25_155.7000MHz_Auto_Police_Dispatch.mp3"（従来互換）
 *
 * @param {Object} params - パラメータオブジェクト
 * @param {Date} [params.date] - 日時（デフォルトは現在時刻）
 * @param {string} [params.freq] - 周波数文字列
 * @param {string} [params.tgid] - トークグループID
 * @param {string} [params.system] - システム名
 * @param {string} [params.department] - デパートメント名
 * @param {string} [params.channel] - チャンネル名
 * @param {string} [params.modulation] - モジュレーション
 * @param {number} [params.seq] - 連番
 * @param {string} [params.ext] - ファイル拡張子（ドットなし）
 * @returns {string} 生成されたファイルパス（ディレクトリ区切りを含む場合あり）
 */
function generateFilename(template, params = {}) {
  const now = params.date || new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours}-${minutes}-${seconds}`;
  const datetimeStr = `${dateStr}_${timeStr}`;

  const replacements = {
    '{date}': dateStr,
    '{time}': timeStr,
    '{datetime}': datetimeStr,
    '{freq}': params.freq || 'unknown',
    '{tgid}': params.tgid || '',
    '{system}': params.system || '',
    '{department}': params.department || '',
    '{channel}': params.channel || '',
    '{modulation}': params.modulation || '',
    '{seq}': params.seq !== undefined ? String(params.seq).padStart(4, '0') : '',
  };

  let result = template;

  // プレースホルダーを置換（まだサニタイズしない）
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(escapeRegex(placeholder), 'g'), value);
  }

  // `/` でセグメントに分割し、各セグメントを個別にサニタイズ
  const segments = result.split('/');
  const sanitizedSegments = segments
    .map((segment) => {
      // 各セグメント内の連続するアンダースコアや先頭/末尾のアンダースコアを除去
      let cleaned = sanitize(segment);
      cleaned = cleaned.replace(/_+/g, '_').replace(/^_|_$/g, '');
      return cleaned;
    })
    .filter((segment) => segment.length > 0); // 空セグメントを除去

  // セグメントが全て空の場合のフォールバック
  if (sanitizedSegments.length === 0) {
    sanitizedSegments.push(`recording_${datetimeStr}`);
  }

  // パスを再構築（OSに依存せず `/` で結合し、後でpath.joinで正規化）
  const relativePath = sanitizedSegments.join('/');

  // 拡張子を付加
  const ext = params.ext || 'mp3';
  return `${relativePath}.${ext}`;
}

/**
 * ファイルシステム上の不正文字をサニタイズする。
 * ディレクトリ区切り文字 `/` は事前に分割済みのため、ここでは除去対象。
 * @param {string} str - 入力文字列
 * @returns {string} サニタイズ済み文字列
 */
function sanitize(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  return str
    .replace(/[<>:"/\\|?*]/g, '') // ファイルシステム不正文字
    .replace(/\s+/g, '_')          // 空白をアンダースコアに
    .replace(/[^\w\-.]/g, '')      // 英数字・ハイフン・ドット・アンダースコア以外を除去
    .trim();
}

/**
 * 正規表現の特殊文字をエスケープする
 * @param {string} str - 入力文字列
 * @returns {string} エスケープ済み文字列
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 指定ディレクトリ配下に同名ファイルが存在する場合、連番サフィックスを付与してユニークな名前を返す。
 * ディレクトリ階層を含むパス（例: "2026-08-08/Dispatch/14-30-25.mp3"）にも対応する。
 * @param {string} baseDir - 録音ベースディレクトリパス
 * @param {string} relativePath - 相対ファイルパス（ディレクトリ区切りを含む場合あり）
 * @returns {string} ユニークな相対ファイルパス
 */
function getUniqueFilename(baseDir, relativePath) {
  const fs = require('fs');

  // パスをディレクトリ部分とファイル名に分離
  const dirPart = path.dirname(relativePath);
  const ext = path.extname(relativePath);
  const base = path.basename(relativePath, ext);

  let candidate = relativePath;
  let counter = 1;

  while (fs.existsSync(path.join(baseDir, candidate))) {
    // ディレクトリ部分を維持しつつファイル名に連番を付与
    const newFilename = `${base}_${String(counter).padStart(3, '0')}${ext}`;
    candidate = dirPart !== '.' ? path.join(dirPart, newFilename) : newFilename;
    // Windows対応: パス区切りを `/` に統一
    candidate = candidate.replace(/\\/g, '/');
    counter++;
  }

  return candidate;
}

/**
 * 受信情報からファイル名パラメータを生成する
 * @param {Object} reception - 受信情報オブジェクト
 * @param {Date} startTime - 受信開始時刻
 * @returns {Object} generateFilename用パラメータ
 */
function fromReceptionData(reception, startTime) {
  return {
    date: startTime || new Date(),
    freq: reception.freqForFilename || reception.rawFreqTgid || '',
    tgid: reception.rawFreqTgid || '',
    system: reception.system || '',
    department: reception.department || '',
    channel: reception.channel || '',
    modulation: reception.modulation || '',
  };
}

/**
 * テンプレート文字列からプレビュー用のサンプルパスを生成する
 * @param {string} template - ファイル名テンプレート
 * @returns {string} サンプルパス文字列
 */
function generatePreview(template) {
  const sampleParams = {
    date: new Date(2026, 7, 8, 14, 30, 25), // 2026-08-08 14:30:25
    freq: '155.7000MHz',
    tgid: '12345',
    system: 'Auto_Police',
    department: 'East',
    channel: 'Dispatch',
    modulation: 'FM',
    seq: 1,
    ext: 'mp3',
  };
  return generateFilename(template, sampleParams);
}

module.exports = {
  generateFilename,
  sanitize,
  getUniqueFilename,
  fromReceptionData,
  generatePreview,
};
