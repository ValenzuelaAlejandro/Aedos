const buildStage1Prompt = require('./stage1-content');
const buildStage2Prompt = require('./stage2-design');
const buildStage3Prompt = require('./stage3-compositor');
const { createLogger, ErrorCategory } = require('../utils/logger');

const pipelineLog = createLogger({ scope: 'PIPELINE' });

const buildLegacyPrompt = require('./base');

/**
 * Repairs invalid escape sequences inside JSON string values.
 *
 * Gemini models occasionally emit backslashes that are not valid JSON escape
 * characters (e.g. Windows paths like "C:\Users\name", or stray \w, \s in
 * text), as well as literal newline/tab characters inside string values.
 * JSON.parse() rejects all of these.
 *
 * This function walks the raw text character-by-character, tracking whether
 * the current position is inside a JSON string, and only within strings it:
 *   1. Doubles any backslash not followed by a recognised JSON escape character
 *      (", \, /, b, f, n, r, t, u).
 *   2. Replaces literal CR/LF with \r / \n.
 *   3. Replaces literal tab characters with \t.
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
 * @returns {object} Parsed JSON object
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

  try {
    const repaired = repairJsonEscapes(cleaned);
    const result = JSON.parse(repaired);
    pipelineLog.warn(ErrorCategory.PIPELINE, 'extractJson: used escape-repair fallback — model emitted invalid JSON escapes');
    return result;
  } catch (finalErr) {
    throw finalErr;
  }
}

/**
 * Runs a non-streaming generation call against the model.
 * @param {Function} tryModelsFn - The tryModels function from server.js
 * @param {string} prompt - The prompt text
 * @param {string} stageName - For logging
 * @param {Function} [onChunk] - Optional callback ({type,text}) => void invoked
 *   on every streamed token. Useful for piping reasoning tokens out to the
 *   chat SSE response without buffering the whole output first.
 * @returns {Promise<string>} The full text response
 */
async function runStage(tryModelsFn, prompt, stageName, onChunk = null) {
  pipelineLog.info(ErrorCategory.PIPELINE, 'Stage started', { stage: stageName });
  const startTime = Date.now();

  const result = await tryModelsFn(prompt);

  let fullText = '';
  for await (const chunk of result.stream) {
    // The stream may be plain text (legacy) or tagged {type,text} objects
    // (chat/reasoning-aware mode). Normalize so we always get a string for
    // the JSON parse AND can still forward reasoning to the client live.
    if (chunk && typeof chunk === 'object' && typeof chunk.text === 'string') {
      if (onChunk) onChunk(chunk);
      if (chunk.type === 'reasoning') continue; // reasoning isn't part of the JSON
      fullText += chunk.text;
    } else if (typeof chunk === 'string') {
      if (onChunk) onChunk({ type: 'content', text: chunk });
      fullText += chunk;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  pipelineLog.success(ErrorCategory.PIPELINE, 'Stage completed', {
    stage: stageName,
    elapsedSeconds: Number(elapsed),
    outputChars: fullText.length
  });

  return fullText;
}

/**
 * Wraps a pipeline stage (model call + JSON parse + validation) with up to
 * `maxRetries` retries on parse/validation errors. CONTENT_REJECTED is treated
 * as a permanent failure (the user input was rejected) and is propagated
 * immediately so we don't waste calls on the same topic.
 *
 * The underlying `tryModels*` callers already retry on 503 and fall back to
 * OpenRouter, so this helper specifically targets the post-call failure mode:
 * the model returns 200 OK but the output is unusable (bad JSON, missing
 * fields). One transient parse miss is common; two in a row is enough to
 * give up and surface the error to the user.
 *
 * @param {object} options
 * @param {Function} options.task - async () => parsed JSON. Must throw an Error
 *   whose .message starts with CONTENT_REJECTED, STAGE1_*, or STAGE2_*.
 * @param {number} [options.maxRetries=2] - extra attempts after the first one
 * @param {string} options.stageName - human-readable stage name for logs
 * @param {string} options.stageKey - 'stage1' | 'stage2' for onStageUpdate
 * @param {Function} options.onStageUpdate - (stageKey, data) => void
 * @returns {Promise<object>} parsed JSON
 */
async function runContentStageWithRetry({ task, maxRetries = 2, stageName, stageKey, onStageUpdate }) {
  let lastError;
  const maxAttempts = maxRetries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      const msg = err && err.message ? err.message : '';
      // Permanent failure: the user's topic was rejected by the model.
      // Retrying with the same prompt will only get the same rejection.
      if (msg.startsWith('CONTENT_REJECTED')) throw err;
      // Out of retries — bubble up so the SSE error path can show a friendly
      // message and the user can try again with different wording.
      if (attempt >= maxAttempts) throw err;

      pipelineLog.warn(ErrorCategory.PIPELINE,
        `${stageName} attempt ${attempt}/${maxAttempts} failed, retrying`, {
        attempt,
        maxAttempts,
        error: msg
      });
      if (onStageUpdate) {
        onStageUpdate(stageKey, {
          status: 'retrying',
          attempt,
          maxAttempts,
          error: msg
        });
      }
      // Small linear backoff so the model/provider can recover from a
      // transient parse miss (e.g. a malformed JSON block).
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError;
}

/**
 * Runs the full 3-stage pipeline.
 * 
 * @param {object} options
 * @param {string} options.rawInput - The sanitized user prompt
 * @param {Function} options.tryModelsStage1 - Caller for Stage 1 (Content)
 * @param {Function} options.tryModelsStage2 - Caller for Stage 2 (Design)
 * @param {Function} options.tryModelsStage3 - Caller for Stage 3 (HTML)
 * @param {Function} [options.tryModels] - Legacy fallback if stage-specific callers not provided
 * @param {Function} options.onStageUpdate - Callback for progress updates: (stage, data) => void
 * @param {number} [options.maxSlides=12] - Hard limit on slides to prevent token waste
 * @returns {object} { stage3Stream, contentJson, designJson } - stage3Stream is the async iterable
 */
/**
 * Enriches a user-edited skeleton with the fields that Stage 2 expects from Stage 1.
 * The outline editor only stores: role, title, subtitle, key_points, bg_color.
 * Stage 2 also needs: visual_world, narrative_structure, tone, audience, text_density,
 * slide_count, plus per-slide core_message, weight, tension, connects_to.
 * We derive sensible defaults here so Stage 2 always gets a complete contentJson.
 *
 * @param {object} skeleton - The skeleton as edited by the user
 * @param {string} rawInput - The original user prompt (used to derive visual_world)
 * @returns {object} Enriched contentJson ready for Stage 2
 */
function enrichSkeletonForStage2(skeleton, rawInput) {
  if (!skeleton || typeof skeleton !== 'object') return skeleton;

  const slides = Array.isArray(skeleton.slides) ? skeleton.slides : [];

  const densityMap = { low: 'low', medium: 'medium', high: 'high' };

  const enriched = {
    language:            skeleton.language            || 'auto',
    topic:               skeleton.topic               || rawInput,
    audience:            skeleton.audience            || 'general',
    tone:                skeleton.tone                || 'corporate',
    text_density:        densityMap[skeleton.density] || densityMap[skeleton.text_density] || 'medium',
    narrative_structure: skeleton.narrative_structure || 'explanatory',
    slide_count:         slides.length,
    author:              skeleton.author              || null,
    team:                skeleton.team                || null,
    teacher:             skeleton.teacher             || null,
    subject:             skeleton.subject             || null,
    institution:         skeleton.institution         || null,
    date:                skeleton.date                || null,
    cta:                 skeleton.cta                 || null,
    visual_world: skeleton.visual_world || {
      real_world_analog: `(Derive from topic: ${rawInput})`,
      color_temperature: 'neutral',
      texture_feel:      'digital',
      typography_energy: 'neutral',
      reference_era:     'contemporary'
    },
    slides: slides.map((slide, idx) => ({
      index:         idx + 1,
      role:          slide.role          || 'concept',
      title:         slide.title         || '',
      subtitle:      slide.subtitle      || null,
      core_message:  slide.core_message  || slide.title || '',
      key_points:    Array.isArray(slide.key_points) ? slide.key_points.filter(Boolean) : [],
      data_points:   Array.isArray(slide.data_points) ? slide.data_points : null,
      tension:       slide.tension       || null,
      weight:        slide.weight        || (idx === 0 ? 'anchor' : idx === slides.length - 1 ? 'anchor' : 'supporting'),
      connects_to:   slide.connects_to   || null,
    }))
  };

  return enriched;
}

async function runPipeline({ rawInput, targetLanguage, fileContext, skeleton, tryModelsStage1, tryModelsStage2, tryModelsStage3, tryModels, onStageUpdate, onChunk, maxSlides = 12 }) {
  const callStage1 = tryModelsStage1 || tryModels;
  const callStage2 = tryModelsStage2 || tryModels;
  const callStage3 = tryModelsStage3 || tryModels;
  // Reasoning chunks are emitted through onChunk, regardless of which stage
  // they come from. We tag them with the stage key so the client can group
  // them visually under "Designing" vs "Composing" headings.
  const stageChunk = (stageKey) => onChunk
    ? (item) => onChunk({ ...item, stage: stageKey })
    : null;
  let contentJson;

  if (skeleton) {
    pipelineLog.info(ErrorCategory.PIPELINE, 'Stage 1 skipped (Skeleton provided)');
    contentJson = enrichSkeletonForStage2(skeleton, rawInput);
    onStageUpdate('stage1', { status: 'done', slideCount: contentJson.slide_count || contentJson.slides?.length || 0 });
  } else {
    onStageUpdate('stage1', { status: 'running' });

    contentJson = await runContentStageWithRetry({
      stageName: 'Stage 1 (Content)',
      stageKey: 'stage1',
      maxRetries: 2,
      onStageUpdate,
      task: async () => {
        const stage1Prompt = buildStage1Prompt(rawInput, targetLanguage);
        const stage1Raw = await runStage(
          (p) => callStage1(p, fileContext),
          stage1Prompt,
          'Stage 1 (Content)',
          stageChunk('stage1')
        );

        let parsed;
        try {
          parsed = extractJson(stage1Raw);
        } catch (e) {
          throw new Error(`STAGE1_PARSE_ERROR: Could not parse Stage 1 output as JSON. Raw: ${stage1Raw.substring(0, 500)}`);
        }

        if (parsed.rejected) {
          // Permanent — the user's input was rejected. The retry helper will
          // see the CONTENT_REJECTED prefix and propagate immediately.
          throw new Error('CONTENT_REJECTED: ' + (parsed.reason || 'Invalid topic'));
        }

        if (!parsed.slides || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
          throw new Error('STAGE1_INVALID: Stage 1 output has no slides array');
        }

        if (parsed.slides.length > maxSlides) {
          pipelineLog.warn(ErrorCategory.VALIDATION, 'Stage 1 exceeded max slides and was trimmed', {
            maxSlides,
            receivedSlides: parsed.slides.length
          });
          parsed.slides = parsed.slides.slice(0, maxSlides);
          parsed.slide_count = maxSlides;
        }

        return parsed;
      }
    });

    onStageUpdate('stage1', { status: 'done', slideCount: contentJson.slide_count });
    pipelineLog.info(ErrorCategory.PIPELINE, 'Stage 1 extracted content', {
      slideCount: contentJson.slide_count,
      topic: contentJson.topic,
      tone: contentJson.tone
    });
  }

  onStageUpdate('stage2', { status: 'running' });

  const designJson = await runContentStageWithRetry({
    stageName: 'Stage 2 (Design)',
    stageKey: 'stage2',
    maxRetries: 2,
    onStageUpdate,
    task: async () => {
      const stage2Prompt = buildStage2Prompt(rawInput, contentJson);
      const stage2Raw = await runStage(callStage2, stage2Prompt, 'Stage 2 (Design)', stageChunk('stage2'));

      let parsed;
      try {
        parsed = extractJson(stage2Raw);
      } catch (e) {
        throw new Error(`STAGE2_PARSE_ERROR: Could not parse Stage 2 output as JSON. Raw: ${stage2Raw.substring(0, 500)}`);
      }

      if (!parsed.palette || !parsed.slides || !Array.isArray(parsed.slides)) {
        throw new Error('STAGE2_INVALID: Stage 2 output missing palette or slides');
      }

      return parsed;
    }
  });
  
  onStageUpdate('stage2', { status: 'done' });
  const p = designJson.palette || {};
  const colors = Array.isArray(p.colors_hex) && p.colors_hex.length > 0
    ? p.colors_hex
    : [p.accent_hex, p.accent2_hex].filter(Boolean);

  const accent1 = colors[0] || 'undefined';
  const accent2 = colors[1] || accent1;

  pipelineLog.info(ErrorCategory.PIPELINE, 'Stage 2 resolved design', {
    palettePrimary: accent1,
    paletteSecondary: accent2,
    fontPair: designJson.font_pair,
    mood: designJson.mood_global
  });
  
  onStageUpdate('stage3', { status: 'running' });
  
  const stage3Prompt = buildStage3Prompt(rawInput, contentJson, designJson);
  pipelineLog.info(ErrorCategory.PIPELINE, 'Stage 3 waiting for rate-limit cool-down', {
    waitMs: 1000
  });
  await new Promise(r => setTimeout(r, 1000));
  pipelineLog.info(ErrorCategory.PIPELINE, 'Stage 3 streaming started');
  
  const stage3Stream = await callStage3(stage3Prompt);
  
  return {
    stage3Stream,
    contentJson,
    designJson,
    stage3Prompt
  };
}

module.exports = {
  runPipeline,
  extractJson,
  buildLegacyPrompt
};
