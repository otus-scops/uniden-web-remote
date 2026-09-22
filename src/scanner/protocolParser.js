/**
 * @fileoverview BCT15X protocol parser
 * @description Parses serial communication protocol responses from the Uniden BCT15X scanner.
 */

/**
 * BCT15X protocol error response codes
 * @enum {string}
 */
const ErrorCodes = {
  ERR: 'ERR',
  NG: 'NG',
  FER: 'FER',
  ORER: 'ORER',
};

/**
 * Field indices in GLG response
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
 * Modulation types mapping
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
 * Convert raw frequency value into human-readable format
 * @param {string} rawFreq - 8-digit frequency string returned from BCT15X (e.g. "08510125")
 * @returns {string} Formatted frequency string (e.g. "851.0125 MHz")
 */
function formatFrequency(rawFreq) {
  if (!rawFreq || rawFreq.trim() === '') {
    return '';
  }

  const numStr = rawFreq.trim();

  // If non-numeric, return as-is since it might be a TGID
  if (!/^\d+$/.test(numStr)) {
    return numStr;
  }

  const num = parseInt(numStr, 10);

  // 8-digit frequency representation: last 4 digits are fractional part
  if (numStr.length >= 7) {
    const mhz = num / 10000;
    return `${mhz.toFixed(4)} MHz`;
  }

  // Treat as TGID
  return numStr;
}

/**
 * Convert frequency value to safe filename format
 * @param {string} rawFreq - Frequency string returned from BCT15X
 * @returns {string} Frequency string suitable for filenames (e.g. "851.0125MHz")
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
 * Parse GLG (Get LCD / Reception State) response
 * @param {string} rawResponse - Raw GLG response string from BCT15X
 * @returns {Object|null} Parsed object, or null if unparseable
 * @property {string} command - Command name ("GLG")
 * @property {string} rawFreqTgid - Raw frequency/TGID value
 * @property {string} freqTgid - Formatted frequency/TGID
 * @property {string} freqForFilename - Frequency formatted for filename
 * @property {string} modulation - Modulation
 * @property {string} attenuator - Attenuator state
 * @property {string} ctcssDcs - CTCSS/DCS settings
 * @property {string} name1 - System name
 * @property {string} name2 - Department name
 * @property {string} name3 - Channel name
 * @property {string} squelch - Squelch state
 * @property {string} mute - Mute state
 * @property {string} sysTag - System tag
 * @property {string} chanTag - Channel tag
 * @property {string} p25nac - P25 NAC
 * @property {boolean} isReceiving - Flag indicating active reception
 */
function parseGlgResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return null;
  }

  const trimmed = rawResponse.trim();

  // Error check
  if (isErrorResponse(trimmed)) {
    return null;
  }

  // Verify GLG prefix
  if (!trimmed.startsWith('GLG,')) {
    return null;
  }

  const fields = trimmed.split(',');

  // Check minimum field count
  if (fields.length < 2) {
    return null;
  }

  const rawFreqTgid = getField(fields, GlgFields.FRQ_TGID);

  // Scanner is not actively receiving when frequency/TGID is blank or all zeroes
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
 * Parse STS (Status) response
 * @param {string} rawResponse - Raw STS response string from BCT15X
 * @returns {Object|null} Parsed object
 * @property {string} command - Command name ("STS")
 * @property {string} raw - Raw response string
 * @property {string[]} fields - Array of comma-separated fields
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
 * Parse MDL (Model) response
 * @param {string} rawResponse - Raw MDL response string from BCT15X
 * @returns {Object|null} Parsed result
 * @property {string} command - "MDL"
 * @property {string} model - Model identifier
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
 * Parse VER (Firmware Version) response
 * @param {string} rawResponse - Raw VER response string from BCT15X
 * @returns {Object|null} Parsed result
 * @property {string} command - "VER"
 * @property {string} version - Firmware version string
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
 * Parse PWR (Signal Strength / RSSI) response
 * @param {string} rawResponse - Raw PWR response string from BCT15X
 * @returns {Object|null} Parsed result
 * @property {string} command - "PWR"
 * @property {number} rssi - Signal strength / RSSI value
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
 * General response parser dispatching to appropriate parser based on command prefix
 * @param {string} rawResponse - Raw response string from BCT15X
 * @returns {Object|null} Parsed result
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

  // OK response
  if (trimmed === 'OK') {
    return { command: 'OK', raw: trimmed };
  }

  // Unknown response
  return { command: 'UNKNOWN', raw: trimmed };
}

/**
 * Check if response indicates an error
 * @param {string} response - Response string
 * @returns {boolean} True if error response
 */
function isErrorResponse(response) {
  return Object.values(ErrorCodes).includes(response.trim());
}

/**
 * Safely retrieve field value from field array
 * @param {string[]} fields - Field array
 * @param {number} index - Field index
 * @returns {string} Field value (empty string if out of range)
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
