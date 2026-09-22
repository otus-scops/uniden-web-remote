/**
 * @fileoverview BCT15X プロトコルパーサー
 * @description BCT15Xのシリアル通信プロトコルの応答を解析する
 */

/**
 * BCT15Xプロトコルのエラーレスポンスコード
 * @enum {string}
 */
const ErrorCodes = {
  ERR: 'ERR',
  NG: 'NG',
  FER: 'FER',
  ORER: 'ORER',
};

/**
 * GLGレスポンスのフィールドインデックス
 * @enum {number}
 */
const GlgFields = {
  COMMAND: 0,
  FRQ_TGID: 1,
  MOD: 2,
  ATT: 3,
  CTCSS_DCS: 4,
  NAME1: 5,
  NAME2: 6,
  NAME3: 7,
  SQL: 8,
  MUT: 9,
  SYS_TAG: 10,
  CHAN_TAG: 11,
  P25NAC: 12,
};

/**
 * モジュレーションタイプの表示名マッピング
 * @type {Object<string, string>}
 */
const ModulationNames = {
  'AM': 'AM',
  'FM': 'FM',
  'NFM': 'NFM',
  'WFM': 'WFM',
  'FMB': 'FMB',
  'P25': 'P25',
  'AUTO': 'AUTO',
};

/**
 * 生の周波数値を読みやすいフォーマットに変換する
 * @param {string} rawFreq - BCT15Xから返された8桁の周波数文字列（例: "08510125"）
 * @returns {string} フォーマットされた周波数文字列（例: "851.0125 MHz"）
 */
function formatFrequency(rawFreq) {
  if (!rawFreq || rawFreq.trim() === '') {
    return '';
  }

  const numStr = rawFreq.trim();

  // 数値でない場合はTGIDの可能性があるのでそのまま返す
  if (!/^\d+$/.test(numStr)) {
    return numStr;
  }

  const num = parseInt(numStr, 10);

  // 8桁の周波数表現：下4桁が小数部
  if (numStr.length >= 7) {
    const mhz = num / 10000;
    return `${mhz.toFixed(4)} MHz`;
  }

  // TGIDとして扱う
  return numStr;
}

/**
 * 周波数値をファイル名に適した文字列に変換する
 * @param {string} rawFreq - BCT15Xから返された周波数文字列
 * @returns {string} ファイル名用の周波数文字列（例: "851.0125MHz"）
 */
function formatFrequencyForFilename(rawFreq) {
  if (!rawFreq || rawFreq.trim() === '') {
    return 'unknown';
  }

  const numStr = rawFreq.trim();

  if (!/^\d+$/.test(numStr)) {
    return numStr;
  }

  const num = parseInt(numStr, 10);

  if (numStr.length >= 7) {
    const mhz = num / 10000;
    return `${mhz.toFixed(4)}MHz`;
  }

  return `TG${numStr}`;
}

/**
 * GLGレスポンスをパースする
 * @param {string} rawResponse - BCT15Xからの生のGLGレスポンス文字列
 * @returns {Object|null} パース結果オブジェクト。パース不可の場合はnull
 * @property {string} command - コマンド名（"GLG"）
 * @property {string} rawFreqTgid - 生の周波数/TGID値
 * @property {string} freqTgid - フォーマットされた周波数/TGID
 * @property {string} freqForFilename - ファイル名用周波数
 * @property {string} modulation - モジュレーション
 * @property {string} attenuator - アッテネータ状態
 * @property {string} ctcssDcs - CTCSS/DCS設定
 * @property {string} name1 - システム名
 * @property {string} name2 - デパートメント名
 * @property {string} name3 - チャンネル名
 * @property {string} squelch - スケルチ状態
 * @property {string} mute - ミュート状態
 * @property {string} sysTag - システムタグ
 * @property {string} chanTag - チャンネルタグ
 * @property {string} p25nac - P25 NAC
 * @property {boolean} isReceiving - 受信中フラグ
 */
function parseGlgResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return null;
  }

  const trimmed = rawResponse.trim();

  // エラーチェック
  if (isErrorResponse(trimmed)) {
    return null;
  }

  // GLGプレフィックス確認
  if (!trimmed.startsWith('GLG,')) {
    return null;
  }

  const fields = trimmed.split(',');

  // 最低限のフィールド数チェック
  if (fields.length < 2) {
    return null;
  }

  const rawFreqTgid = getField(fields, GlgFields.FRQ_TGID);

  // 周波数/TGIDが空の場合は受信していない
  const isReceiving = rawFreqTgid !== '' && rawFreqTgid !== '00000000';

  return {
    command: 'GLG',
    rawFreqTgid,
    freqTgid: formatFrequency(rawFreqTgid),
    freqForFilename: formatFrequencyForFilename(rawFreqTgid),
    modulation: getField(fields, GlgFields.MOD),
    attenuator: getField(fields, GlgFields.ATT),
    ctcssDcs: getField(fields, GlgFields.CTCSS_DCS),
    name1: getField(fields, GlgFields.NAME1),
    name2: getField(fields, GlgFields.NAME2),
    name3: getField(fields, GlgFields.NAME3),
    squelch: getField(fields, GlgFields.SQL),
    mute: getField(fields, GlgFields.MUT),
    sysTag: getField(fields, GlgFields.SYS_TAG),
    chanTag: getField(fields, GlgFields.CHAN_TAG),
    p25nac: getField(fields, GlgFields.P25NAC),
    isReceiving,
  };
}

/**
 * STSレスポンスをパースする
 * @param {string} rawResponse - BCT15Xからの生のSTSレスポンス文字列
 * @returns {Object|null} パース結果オブジェクト
 * @property {string} command - コマンド名（"STS"）
 * @property {string} raw - 生のレスポンス文字列
 * @property {string[]} fields - カンマ区切りのフィールド配列
 */
function parseStsResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return null;
  }

  const trimmed = rawResponse.trim();

  if (isErrorResponse(trimmed)) {
    return null;
  }

  if (!trimmed.startsWith('STS,')) {
    return null;
  }

  const fields = trimmed.split(',');

  return {
    command: 'STS',
    raw: trimmed,
    fields,
  };
}

/**
 * MDLレスポンスをパースする
 * @param {string} rawResponse - BCT15Xからの生のMDLレスポンス文字列
 * @returns {Object|null} パース結果
 * @property {string} command - "MDL"
 * @property {string} model - モデル名
 */
function parseMdlResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return null;
  }

  const trimmed = rawResponse.trim();

  if (isErrorResponse(trimmed)) {
    return null;
  }

  if (!trimmed.startsWith('MDL,')) {
    return null;
  }

  const fields = trimmed.split(',');

  return {
    command: 'MDL',
    model: getField(fields, 1),
  };
}

/**
 * VERレスポンスをパースする
 * @param {string} rawResponse - BCT15Xからの生のVERレスポンス文字列
 * @returns {Object|null} パース結果
 * @property {string} command - "VER"
 * @property {string} version - ファームウェアバージョン
 */
function parseVerResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return null;
  }

  const trimmed = rawResponse.trim();

  if (isErrorResponse(trimmed)) {
    return null;
  }

  if (!trimmed.startsWith('VER,')) {
    return null;
  }

  const fields = trimmed.split(',');

  return {
    command: 'VER',
    version: getField(fields, 1),
  };
}

/**
 * PWRレスポンスをパースする（信号強度/RSSI）
 * @param {string} rawResponse - BCT15Xからの生のPWRレスポンス文字列
 * @returns {Object|null} パース結果
 * @property {string} command - "PWR"
 * @property {number} rssi - 信号強度値
 */
function parsePwrResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return null;
  }

  const trimmed = rawResponse.trim();

  if (isErrorResponse(trimmed)) {
    return null;
  }

  if (!trimmed.startsWith('PWR,')) {
    return null;
  }

  const fields = trimmed.split(',');
  const rssiStr = getField(fields, 1);

  return {
    command: 'PWR',
    rssi: rssiStr ? parseInt(rssiStr, 10) : 0,
  };
}

/**
 * 汎用レスポンスパーサー。コマンドプレフィックスに基づいて適切なパーサーを選択する
 * @param {string} rawResponse - BCT15Xからの生のレスポンス文字列
 * @returns {Object|null} パース結果
 */
function parseResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return null;
  }

  const trimmed = rawResponse.trim();

  if (isErrorResponse(trimmed)) {
    return { command: 'ERROR', code: trimmed, raw: trimmed };
  }

  if (trimmed.startsWith('GLG,') || trimmed === 'GLG,') {
    return parseGlgResponse(trimmed);
  }

  if (trimmed.startsWith('STS,')) {
    return parseStsResponse(trimmed);
  }

  if (trimmed.startsWith('MDL,')) {
    return parseMdlResponse(trimmed);
  }

  if (trimmed.startsWith('VER,')) {
    return parseVerResponse(trimmed);
  }

  if (trimmed.startsWith('PWR,')) {
    return parsePwrResponse(trimmed);
  }

  // OK応答
  if (trimmed === 'OK') {
    return { command: 'OK', raw: trimmed };
  }

  // 未知のレスポンス
  return { command: 'UNKNOWN', raw: trimmed };
}

/**
 * レスポンスがエラーかどうかを判定する
 * @param {string} response - レスポンス文字列
 * @returns {boolean} エラーの場合true
 */
function isErrorResponse(response) {
  return Object.values(ErrorCodes).includes(response.trim());
}

/**
 * フィールド配列から安全にフィールド値を取得する
 * @param {string[]} fields - フィールド配列
 * @param {number} index - フィールドインデックス
 * @returns {string} フィールド値（存在しない場合は空文字列）
 */
function getField(fields, index) {
  if (index >= 0 && index < fields.length) {
    return fields[index].trim();
  }
  return '';
}

module.exports = {
  parseGlgResponse,
  parseStsResponse,
  parseMdlResponse,
  parseVerResponse,
  parsePwrResponse,
  parseResponse,
  isErrorResponse,
  formatFrequency,
  formatFrequencyForFilename,
  ErrorCodes,
  GlgFields,
  ModulationNames,
};
