/**
 * @fileoverview BCT15X DMA (Dynamic Memory Architecture) プロトコル定義およびパーサー
 * @description Uniden BCT15Xのプログラミングモードにおけるコマンド生成と応答解析を行う
 */

/**
 * システムタイプ定義
 * @enum {string}
 */
const SystemTypes = {
  CONVENTIONAL: 'CNV',
  MOTOROLA: 'MOT',
  EDACS_NARROW_WIDE: 'EDC',
  EDACS_SCAT: 'EDS',
  LTR: 'LTR',
};

/**
 * モジュレーション（変調方式）定義
 * @enum {string}
 */
const Modulations = {
  AUTO: 'AUTO',
  AM: 'AM',
  FM: 'FM',
  NFM: 'NFM',
  WFM: 'WFM',
  FMB: 'FMB',
};

/**
 * CTCSS / DCS コード一覧テーブル (BCT15X仕様書準拠)
 */
const CTCSS_DCS_TABLE = {
  0: 'None / All',
  127: 'Search',
  // CTCSS (64 - 113)
  64: 'CTCSS 67.0Hz',
  65: 'CTCSS 69.3Hz',
  66: 'CTCSS 71.9Hz',
  67: 'CTCSS 74.4Hz',
  68: 'CTCSS 77.0Hz',
  69: 'CTCSS 79.7Hz',
  70: 'CTCSS 82.5Hz',
  71: 'CTCSS 85.4Hz',
  72: 'CTCSS 88.5Hz',
  73: 'CTCSS 91.5Hz',
  74: 'CTCSS 94.8Hz',
  75: 'CTCSS 97.4Hz',
  76: 'CTCSS 100.0Hz',
  77: 'CTCSS 103.5Hz',
  78: 'CTCSS 107.2Hz',
  79: 'CTCSS 110.9Hz',
  80: 'CTCSS 114.8Hz',
  81: 'CTCSS 118.8Hz',
  82: 'CTCSS 123.0Hz',
  83: 'CTCSS 127.3Hz',
  84: 'CTCSS 131.8Hz',
  85: 'CTCSS 136.5Hz',
  86: 'CTCSS 141.3Hz',
  87: 'CTCSS 146.2Hz',
  88: 'CTCSS 151.4Hz',
  89: 'CTCSS 156.7Hz',
  90: 'CTCSS 159.8Hz',
  91: 'CTCSS 162.2Hz',
  92: 'CTCSS 165.5Hz',
  93: 'CTCSS 167.9Hz',
  94: 'CTCSS 171.3Hz',
  95: 'CTCSS 173.8Hz',
  96: 'CTCSS 177.3Hz',
  97: 'CTCSS 179.9Hz',
  98: 'CTCSS 183.5Hz',
  99: 'CTCSS 186.2Hz',
  100: 'CTCSS 189.9Hz',
  101: 'CTCSS 192.8Hz',
  102: 'CTCSS 196.6Hz',
  103: 'CTCSS 199.5Hz',
  104: 'CTCSS 203.5Hz',
  105: 'CTCSS 206.5Hz',
  106: 'CTCSS 210.7Hz',
  107: 'CTCSS 218.1Hz',
  108: 'CTCSS 225.7Hz',
  109: 'CTCSS 229.1Hz',
  110: 'CTCSS 233.6Hz',
  111: 'CTCSS 241.8Hz',
  112: 'CTCSS 250.3Hz',
  113: 'CTCSS 254.1Hz',
  // DCS (128 - 231)
  128: 'DCS 023',
  129: 'DCS 025',
  130: 'DCS 026',
  131: 'DCS 031',
  132: 'DCS 032',
  133: 'DCS 036',
  134: 'DCS 043',
  135: 'DCS 047',
  136: 'DCS 051',
  137: 'DCS 053',
  138: 'DCS 054',
  139: 'DCS 065',
  140: 'DCS 071',
  141: 'DCS 072',
  142: 'DCS 073',
  143: 'DCS 074',
  144: 'DCS 114',
  145: 'DCS 115',
  146: 'DCS 116',
  147: 'DCS 122',
  148: 'DCS 125',
  149: 'DCS 131',
  150: 'DCS 132',
  151: 'DCS 134',
  152: 'DCS 143',
  153: 'DCS 145',
  154: 'DCS 152',
  155: 'DCS 155',
  156: 'DCS 156',
  157: 'DCS 162',
  158: 'DCS 165',
  159: 'DCS 172',
  160: 'DCS 174',
  161: 'DCS 205',
  162: 'DCS 212',
  163: 'DCS 223',
  164: 'DCS 225',
  165: 'DCS 226',
  166: 'DCS 243',
  167: 'DCS 244',
  168: 'DCS 245',
  169: 'DCS 246',
  170: 'DCS 251',
  171: 'DCS 252',
  172: 'DCS 255',
  173: 'DCS 261',
  174: 'DCS 263',
  175: 'DCS 265',
  176: 'DCS 266',
  177: 'DCS 271',
  178: 'DCS 274',
  179: 'DCS 306',
  180: 'DCS 311',
  181: 'DCS 315',
  182: 'DCS 325',
  183: 'DCS 331',
  184: 'DCS 332',
  185: 'DCS 343',
  186: 'DCS 346',
  187: 'DCS 351',
  188: 'DCS 356',
  189: 'DCS 364',
  190: 'DCS 365',
  191: 'DCS 371',
  192: 'DCS 411',
  193: 'DCS 412',
  194: 'DCS 413',
  195: 'DCS 423',
  196: 'DCS 431',
  197: 'DCS 432',
  198: 'DCS 445',
  199: 'DCS 446',
  200: 'DCS 452',
  201: 'DCS 454',
  202: 'DCS 455',
  203: 'DCS 462',
  204: 'DCS 464',
  205: 'DCS 465',
  206: 'DCS 466',
  207: 'DCS 503',
  208: 'DCS 506',
  209: 'DCS 516',
  210: 'DCS 523',
  211: 'DCS 526',
  212: 'DCS 532',
  213: 'DCS 546',
  214: 'DCS 565',
  215: 'DCS 606',
  216: 'DCS 612',
  217: 'DCS 624',
  218: 'DCS 627',
  219: 'DCS 631',
  220: 'DCS 632',
  221: 'DCS 654',
  222: 'DCS 662',
  223: 'DCS 664',
  224: 'DCS 703',
  225: 'DCS 712',
  226: 'DCS 723',
  227: 'DCS 731',
  228: 'DCS 732',
  229: 'DCS 734',
  230: 'DCS 743',
  231: 'DCS 754',
};

// 逆引きマップ
const REVERSE_CTCSS_DCS_TABLE = {};
for (const [code, label] of Object.entries(CTCSS_DCS_TABLE)) {
  REVERSE_CTCSS_DCS_TABLE[label] = parseInt(code, 10);
  // 短縮表記も対応（例: "88.5" や "D023"）
  const simpleMatch = label.match(/^(?:CTCSS\s+)?(\d+\.?\d*Hz?)|^(?:DCS\s+)?(\d+)/i);
  if (simpleMatch) {
    if (simpleMatch[1]) REVERSE_CTCSS_DCS_TABLE[simpleMatch[1].replace('Hz', '')] = parseInt(code, 10);
    if (simpleMatch[2]) REVERSE_CTCSS_DCS_TABLE[simpleMatch[2]] = parseInt(code, 10);
  }
}

/**
 * 周波数を8桁のBCT15X生フォーマットに変換する (MHz -> 8桁数字)
 * @param {string|number} freqMhz - 例: "155.7000" または 155.7
 * @returns {string} 8桁周波数文字列 (例: "01557000")
 */
function toRawFrequency(freqMhz) {
  if (!freqMhz) return '00000000';
  const num = parseFloat(String(freqMhz).replace(/[^\d.]/g, ''));
  if (isNaN(num)) return '00000000';
  const val = Math.round(num * 10000);
  return String(val).padStart(8, '0');
}

/**
 * BCT15X生周波数フォーマットをMHz文字列に変換する
 * @param {string} rawFreq - 8桁周波数文字列 (例: "01557000")
 * @returns {string} フォーマット周波数 (例: "155.7000")
 */
function fromRawFrequency(rawFreq) {
  if (!rawFreq) return '0.0000';
  const num = parseInt(rawFreq.trim(), 10);
  if (isNaN(num)) return rawFreq;
  return (num / 10000).toFixed(4);
}

/**
 * トーンコードをラベル文字列に変換する
 * @param {number|string} code - コード番号 (0-231)
 * @returns {string} トーン名 (例: "CTCSS 88.5Hz", "None / All")
 */
function fromToneCode(code) {
  const num = parseInt(code, 10);
  return CTCSS_DCS_TABLE[num] || 'None / All';
}

/**
 * トーンラベル文字列をコード番号に変換する
 * @param {string} label - トーン名
 * @returns {number} コード番号
 */
function toToneCode(label) {
  if (!label) return 0;
  if (typeof label === 'number') return label;
  const trimmed = label.trim();
  if (REVERSE_CTCSS_DCS_TABLE[trimmed] !== undefined) {
    return REVERSE_CTCSS_DCS_TABLE[trimmed];
  }
  const parsed = parseInt(trimmed, 10);
  if (!isNaN(parsed) && CTCSS_DCS_TABLE[parsed]) return parsed;
  return 0;
}

/**
 * SIH応答をパースする
 * @param {string} response - "SIH,10" または "SIH,-1"
 * @returns {number} システムヘッドインデックス (-1は空)
 */
function parseSihResponse(response) {
  const parts = response.trim().split(',');
  if (parts.length >= 2 && parts[0] === 'SIH') {
    return parseInt(parts[1], 10);
  }
  return -1;
}

/**
 * SIN応答をパースする
 * フォーマット: SIN,[SYS_TYPE],[NAME],[QUICK_KEY],[HLD],[LOUT],[DLY],...,[REV_INDEX],[FWD_INDEX],[CHN_GRP_HEAD],[CHN_GRP_TAIL],...
 * @param {string} response - レスポンス文字列
 * @param {number} index - 問い合わせたシステムインデックス
 * @returns {Object|null}
 */
function parseSinResponse(response, index) {
  const parts = response.trim().split(',');
  if (parts[0] !== 'SIN' || parts.length < 15) {
    return null;
  }

  return {
    id: index,
    type: parts[1], // CNV, MOT, EDC, EDS, LTR
    name: parts[2] ? parts[2].trim() : `System ${index}`,
    quickKey: parts[3] === '.' ? null : parseInt(parts[3], 10),
    holdTime: parseInt(parts[4], 10) || 0,
    lockout: parts[5] === '1',
    delay: parseInt(parts[6], 10) || 2,
    revIndex: parseInt(parts[12], 10),
    fwdIndex: parseInt(parts[13], 10),
    groupHead: parseInt(parts[14], 10),
    groupTail: parseInt(parts[15], 10),
    rawParts: parts,
  };
}

/**
 * GIN応答をパースする
 * フォーマット: GIN,[GRP_TYPE],[NAME],[QUICK_KEY],[LOUT],[REV_INDEX],[FWD_INDEX],[SYS_INDEX],[CHN_HEAD],[CHN_TAIL],...
 * @param {string} response - レスポンス文字列
 * @param {number} index - グループインデックス
 * @returns {Object|null}
 */
function parseGinResponse(response, index) {
  const parts = response.trim().split(',');
  if (parts[0] !== 'GIN' || parts.length < 10) {
    return null;
  }

  return {
    id: index,
    groupType: parts[1], // C: Channel, T: TGID
    name: parts[2] ? parts[2].trim() : `Group ${index}`,
    quickKey: parts[3] === '.' ? null : parts[3] === '0' ? 10 : parseInt(parts[3], 10),
    lockout: parts[4] === '1',
    revIndex: parseInt(parts[5], 10),
    fwdIndex: parseInt(parts[6], 10),
    systemId: parseInt(parts[7], 10),
    channelHead: parseInt(parts[8], 10),
    channelTail: parseInt(parts[9], 10),
    rawParts: parts,
  };
}

/**
 * CIN応答をパースする (Conventional Channel)
 * フォーマット: CIN,[NAME],[FRQ],[MOD],[CTCSS/DCS],[TLOCK],[LOUT],[PRI],[ATT],[ALT],[ALTL],[REV_INDEX],[FWD_INDEX],[SYS_INDEX],[GRP_INDEX],...
 * @param {string} response - レスポンス文字列
 * @param {number} index - チャンネルインデックス
 * @returns {Object|null}
 */
function parseCinResponse(response, index) {
  const parts = response.trim().split(',');
  if (parts[0] !== 'CIN' || parts.length < 15) {
    return null;
  }

  const toneCode = parseInt(parts[4], 10) || 0;

  return {
    id: index,
    name: parts[1] ? parts[1].trim() : '',
    frequency: fromRawFrequency(parts[2]),
    rawFrequency: parts[2],
    modulation: parts[3] || 'AUTO',
    toneCode,
    tone: fromToneCode(toneCode),
    toneLockout: parts[5] === '1',
    lockout: parts[6] === '1',
    priority: parts[7] === '1',
    attenuator: parts[8] === '1',
    alertTone: parseInt(parts[9], 10) || 0,
    alertLevel: parts[10] === 'AUTO' ? 'AUTO' : parseInt(parts[10], 10) || 0,
    revIndex: parseInt(parts[11], 10),
    fwdIndex: parseInt(parts[12], 10),
    systemId: parseInt(parts[13], 10),
    groupId: parseInt(parts[14], 10),
    rawParts: parts,
  };
}

/**
 * CSY応答 (システム作成応答) をパースする
 * @param {string} response - "CSY,[SYS_INDEX]"
 * @returns {number} 作成されたシステムインデックス (-1は失敗)
 */
function parseCsyResponse(response) {
  const parts = response.trim().split(',');
  if (parts[0] === 'CSY' && parts.length >= 2) {
    return parseInt(parts[1], 10);
  }
  return -1;
}

/**
 * AGC応答 (グループ追加応答) をパースする
 * @param {string} response - "AGC,[GRP_INDEX]"
 * @returns {number} 作成されたグループインデックス (-1は失敗)
 */
function parseAgcResponse(response) {
  const parts = response.trim().split(',');
  if (parts[0] === 'AGC' && parts.length >= 2) {
    return parseInt(parts[1], 10);
  }
  return -1;
}

/**
 * ACC応答 (チャンネル追加応答) をパースする
 * @param {string} response - "ACC,[CHN_INDEX]"
 * @returns {number} 作成されたチャンネルインデックス (-1は失敗)
 */
function parseAccResponse(response) {
  const parts = response.trim().split(',');
  if (parts[0] === 'ACC' && parts.length >= 2) {
    return parseInt(parts[1], 10);
  }
  return -1;
}

/**
 * SIN設定コマンド文字列を構築する
 * @param {Object} sys - システムデータ
 * @returns {string} コマンド文字列
 */
function buildSinCommand(sys) {
  const qk = sys.quickKey !== null && sys.quickKey !== undefined ? sys.quickKey : '.';
  const hld = sys.holdTime !== undefined ? sys.holdTime : 2;
  const lout = sys.lockout ? '1' : '0';
  const dly = sys.delay !== undefined ? sys.delay : 2;
  const name = (sys.name || '').substring(0, 16);
  // SIN,[INDEX],[NAME],[QUICK_KEY],[HLD],[LOUT],[DLY],[RSV],[RSV],[RSV],[RSV],[RSV],[START_KEY],[RECORD],[RSV],[RSV],[RSV],[RSV],[STATE],[NUMBER_TAG],[RSV],[RSV],[RSV]
  return `SIN,${sys.id},${name},${qk},${hld},${lout},${dly},,,,,.,0,,,,00,NONE,,,`;
}

/**
 * GIN設定コマンド文字列を構築する
 * @param {Object} grp - グループデータ
 * @returns {string} コマンド文字列
 */
function buildGinCommand(grp) {
  const qk = grp.quickKey !== null && grp.quickKey !== undefined ? (grp.quickKey === 10 ? '0' : grp.quickKey) : '.';
  const lout = grp.lockout ? '1' : '0';
  const name = (grp.name || '').substring(0, 16);
  // GIN,[GRP_INDEX],[NAME],[QUICK_KEY],[LOUT],[LATITUDE],[LONGITUDE],[RANGE],[GPS ENABLE]
  return `GIN,${grp.id},${name},${qk},${lout},,,,,0`;
}

/**
 * CIN設定コマンド文字列を構築する
 * @param {Object} chn - チャンネルデータ
 * @returns {string} コマンド文字列
 */
function buildCinCommand(chn) {
  const name = (chn.name || '').substring(0, 16);
  const rawFreq = chn.rawFrequency || toRawFrequency(chn.frequency);
  const mod = chn.modulation || 'AUTO';
  const toneCode = chn.toneCode !== undefined ? chn.toneCode : toToneCode(chn.tone);
  const tlock = chn.toneLockout ? '1' : '0';
  const lout = chn.lockout ? '1' : '0';
  const pri = chn.priority ? '1' : '0';
  const att = chn.attenuator ? '1' : '0';
  const alt = chn.alertTone !== undefined ? chn.alertTone : 0;
  const altl = chn.alertLevel !== undefined ? chn.alertLevel : 'AUTO';
  // CIN,[INDEX],[NAME],[FRQ],[MOD],[CTCSS/DCS],[TLOCK],[LOUT],[PRI],[ATT],[ALT],[ALTL],[RECORD],[RSV],[RSV],[NUMBER_TAG],[RSV],[ALT_PATTERN],[VOL_OFFSET]
  return `CIN,${chn.id},${name},${rawFreq},${mod},${toneCode},${tlock},${lout},${pri},${att},${alt},${altl},0,,,NONE,,0,0`;
}

module.exports = {
  SystemTypes,
  Modulations,
  CTCSS_DCS_TABLE,
  REVERSE_CTCSS_DCS_TABLE,
  toRawFrequency,
  fromRawFrequency,
  fromToneCode,
  toToneCode,
  parseSihResponse,
  parseSinResponse,
  parseGinResponse,
  parseCinResponse,
  parseCsyResponse,
  parseAgcResponse,
  parseAccResponse,
  buildSinCommand,
  buildGinCommand,
  buildCinCommand,
};
