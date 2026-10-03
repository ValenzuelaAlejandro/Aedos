const { createLogger, ErrorCategory } = require('../utils/logger');

/** @typedef {Record<string, any>} ParsedModelJson */

const pipelineLog = createLogger({ scope: 'PIPELINE' });

/**
 * Repairs invalid escape sequences inside JSON string values.
 *
 * Gemini models occasionally emit backslashes that are not valid JSON escape
 * characters (e.g. Windows paths like "C:\\Users\\name", or stray \\w, \\s in
 * text), as well as literal newline/tab characters inside string values.
 * JSON.parse() rejects all of these.
 *
 * This function walks the raw text character-by-character, tracking whether
 * the current position is inside a JSON string, and only within strings it:
 *   1. Doubles any backslash not followed by a recognised JSON escape character
 *      (\", \\, /, b, f, n, r, t, u).
 *   2. Replaces literal CR/LF with \\r / \\n.
 *   3. Replaces literal tab characters with \\t.
 *
 * Characters outside strings (structural JSON) are passed through unchanged.
 *
 * @param {string} text - A JSON string that may contain bad escape sequences
 * @returns {string} Repaired JSON string
 */
function repairJsonEscapes(text) {
  const VALID_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);
  let out = '';
  let inString = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (!inString) {
      if (ch === '"') {
        inString = true;
        out += ch;
        i++;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === '\\') {
      const next = text[i + 1];
      if (next !== undefined && VALID_ESCAPES.has(next)) {
        out += ch + next;
        i += 2;
      } else {
        out += '\\\\';
        i++;
      }
      continue;
    }

    if (ch === '"') {
      inString = false;
      out += ch;
      i++;
      continue;
    }

    if (ch === '\n') { out += '\\n'; i++; continue; }
    if (ch === '\r') { out += '\\r'; i++; continue; }
    if (ch === '\t') { out += '\\t'; i++; continue; }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Extracts and parses JSON from a model response that may contain markdown
 * fences, extra prose, JS comments, or invalid escape sequences.
 *
 * Parsing strategy (cascading - stops at the first success):
 *   Level 1 - Direct JSON.parse() on the trimmed text.
 *   Level 2 - Strip markdown fences, extract the outermost {...} block,
 *             strip JS-style // comments, then JSON.parse().
 *   Level 3 - Apply repairJsonEscapes() to the cleaned text, then JSON.parse().
 *             A warning is logged when this level is reached so we can track
 *             how often the model emits malformed escapes.
 *
 * @param {string} text - Raw model output
 * @returns {ParsedModelJson} Parsed JSON object
 */
function extractJson(text) {
  try {
    return JSON.parse(text.trim());
  } catch (_) { /* fall through */ }

  let cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace  = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  cleaned = cleaned.replace(/\/\/[^\n"]*/g, '');

  try {
    return JSON.parse(cleaned);
  } catch (_) { /* fall through to repair */ }

  // Preserve the original throw-through path; changing this error handling is outside the extraction.
  // eslint-disable-next-line no-useless-catch -- retain the pipeline's established exception path
  try {
    const repaired = repairJsonEscapes(cleaned);
    const result = JSON.parse(repaired);
    pipelineLog.warn(ErrorCategory.PIPELINE, 'extractJson: used escape-repair fallback — model emitted invalid JSON escapes');
    return result;
  } catch (finalErr) {
    throw finalErr;
  }
}

module.exports = { extractJson, repairJsonEscapes };
