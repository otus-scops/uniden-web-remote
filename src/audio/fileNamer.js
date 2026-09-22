/**
 * @fileoverview File naming utility
 * @description Provides template-based naming and path sanitization for recordings.
 * Including `/` in templates automatically generates directory hierarchies.
 */

const path = require('path');

/**
 * Generate a filename (including directory paths) by replacing template placeholders with actual values.
 * If the template contains `/`, it is processed as directory path segments.
 *
 * @param {string} template - Filename template
 *   Available placeholders:
 *   - {date} : Date (YYYY-MM-DD)
 *   - {time} : Time (HH-mm-ss)
 *   - {datetime} : Date & Time (YYYY-MM-DD_HH-mm-ss)
 *   - {freq} : Frequency
 *   - {tgid} : Talkgroup ID
 *   - {system} : System name
 *   - {department} : Department name
 *   - {channel} : Channel name
 *   - {modulation} : Modulation
 *   - {seq} : Sequential number
 *
 *   Template examples:
 *   - "{date}/{channel}/{time}_{freq}" → "2026-08-08/Dispatch/14-30-25_155.7000MHz.mp3"
 *   - "{date}_{time}_{freq}_{system}_{channel}" → "2026-08-08_14-30-25_155.7000MHz_Auto_Police_Dispatch.mp3" (backward compatible)
 *
 * @param {Object} params - Parameter values object
 * @param {Date} [params.date] - Date/time (defaults to current time)
 * @param {string} [params.freq] - Frequency string
 * @param {string} [params.tgid] - Talkgroup ID
 * @param {string} [params.system] - System name
 * @param {string} [params.department] - Department name
 * @param {string} [params.channel] - Channel name
 * @param {string} [params.modulation] - Modulation
 * @param {number} [params.seq] - Sequential index
 * @param {string} [params.ext] - File extension without leading dot
 * @returns {string} Generated file path (may contain directory separators)
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

  // Replace placeholders (without sanitizing full string yet)
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(escapeRegex(placeholder), 'g'), value);
  }

  // Split into segments by `/` and sanitize each segment individually
  const segments = result.split('/');
  const sanitizedSegments = segments
    .map((segment) => {
      // Remove consecutive underscores and leading/trailing underscores within segment
      let cleaned = sanitize(segment);
      cleaned = cleaned.replace(/_+/g, '_').replace(/^_|_$/g, '');
      return cleaned;
    })
    .filter((segment) => segment.length > 0); // Remove empty segments

  // Fallback if all segments are empty
  if (sanitizedSegments.length === 0) {
    sanitizedSegments.push(`recording_${datetimeStr}`);
  }

  // Reconstruct path with `/` delimiter (normalized later with path functions)
  const relativePath = sanitizedSegments.join('/');

  // Append file extension
  const ext = params.ext || 'mp3';
  return `${relativePath}.${ext}`;
}

/**
 * Sanitize illegal filesystem characters.
 * Directory delimiter `/` is stripped here as path segments are pre-split.
 * @param {string} str - Input string
 * @returns {string} Sanitized string
 */
function sanitize(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  return str
    .replace(/[<>:"/\\|?*]/g, '') // Remove filesystem invalid characters
    .replace(/\s+/g, '_')          // Convert whitespace to underscore
    .replace(/[^\w\-.]/g, '')      // Remove everything except alphanumeric, hyphen, dot, underscore
    .trim();
}

/**
 * Escape special characters for regular expressions
 * @param {string} str - Input string
 * @returns {string} Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if target file exists in base directory; if so, append sequential numeric suffix to ensure uniqueness.
 * Supports paths containing directory hierarchies (e.g. "2026-08-08/Dispatch/14-30-25.mp3").
 * @param {string} baseDir - Base recordings directory path
 * @param {string} relativePath - Relative file path (may contain directory delimiters)
 * @returns {string} Unique relative file path
 */
function getUniqueFilename(baseDir, relativePath) {
  const fs = require('fs');

  // Separate directory portion and file basename
  const dirPart = path.dirname(relativePath);
  const ext = path.extname(relativePath);
  const base = path.basename(relativePath, ext);

  let candidate = relativePath;
  let counter = 1;

  while (fs.existsSync(path.join(baseDir, candidate))) {
    // Retain directory portion while appending counter to file basename
    const newFilename = `${base}_${String(counter).padStart(3, '0')}${ext}`;
    candidate = dirPart !== '.' ? path.join(dirPart, newFilename) : newFilename;
    // Cross-platform normalization: unify delimiters to `/`
    candidate = candidate.replace(/\\/g, '/');
    counter++;
  }

  return candidate;
}

/**
 * Generate filename parameters from reception metadata
 * @param {Object} reception - Reception metadata object
 * @param {Date} startTime - Reception start time
 * @returns {Object} Parameters object for generateFilename
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
 * Generate preview sample path from template string
 * @param {string} template - Filename template
 * @returns {string} Sample path string
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
