/**
 * Pipeline Orchestrator
 * 
 * Coordinates the 3-stage generation pipeline:
 *   Stage 1 (Content) → Stage 2 (Design) → Stage 3 (HTML, streamed)
 * 
 * Stages 1 and 2 are non-streaming JSON calls.
 * Stage 3 is streamed via SSE to the client.
 */

const buildStage1Prompt = require('./stage1-content');
const buildStage2Prompt = require('./stage2-design');
const buildStage3Prompt = require('./stage3-compositor');
const { createLogger, ErrorCategory } = require('../utils/logger');

const pipelineLog = createLogger({ scope: 'PIPELINE' });

// Re-export the legacy prompt for backwards compatibility
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
      // Entering a string
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

    // Inside a JSON string value
    if (ch === '\\') {
      const next = text[i + 1];
      if (next !== undefined && VALID_ESCAPES.has(next)) {
        // Valid escape sequence — keep as-is
        out += ch + next;
        i += 2;
      } else {
        // Invalid escape — double the backslash to make it a literal backslash
        out += '\\\\';
        i++;
      }
      continue;
    }

    if (ch === '"') {
      // End of string
      inString = false;
      out += ch;
      i++;
      continue;
    }

    // Literal control characters inside a string — these are never valid in JSON
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
 * Parsing strategy (cascading — stops at the first success):
 *   Level 1 — Direct JSON.parse() on the trimmed text.
 *   Level 2 — Strip markdown fences, extract the outermost {...} block,
 *              strip JS-style // comments, then JSON.parse().
 *   Level 3 — Apply repairJsonEscapes() to the cleaned text, then JSON.parse().
 *              A warning is logged when this level is reached so we can track
 *              how often the model emits malformed escapes.
 *
 * @param {string} text - Raw model output
 * @returns {object} Parsed JSON object
 */
function extractJson(text) {
  // ── Level 1: direct parse ──────────────────────────────────────────────────
  try {
    return JSON.parse(text.trim());
  } catch (_) { /* fall through */ }

  // ── Level 2: strip fences + brace extraction + strip JS comments ───────────
  let cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace  = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  // Strip JS-style // line comments (model sometimes copies comment syntax from prompt examples)
  cleaned = cleaned.replace(/\/\/[^\n"]*/g, '');

  try {
    return JSON.parse(cleaned);
  } catch (_) { /* fall through to repair */ }

  // ── Level 3: repair bad escape sequences ──────────────────────────────────
  try {
    const repaired = repairJsonEscapes(cleaned);
    const result = JSON.parse(repaired);
    // Log so we can monitor how often the model produces bad escapes
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
 * @returns {Promise<string>} The full text response
 */
async function runStage(tryModelsFn, prompt, stageName) {
  pipelineLog.info(ErrorCategory.PIPELINE, 'Stage started', { stage: stageName });
  const startTime = Date.now();
  
  const result = await tryModelsFn(prompt);
  
  // Collect the full streamed response
  let fullText = '';
  for await (const chunk of result.stream) {
    fullText += chunk;
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

  // Map editor density to Stage 1 text_density enum
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
    // Provide a visual_world block so Stage 2 has a creative anchor.
    // If the user-skeleton already has one (carried over from a previous Stage 1 run)
    // we keep it; otherwise we derive a lightweight placeholder.
    visual_world: skeleton.visual_world || {
      real_world_analog: `(Derive from topic: ${rawInput})`,
      color_temperature: 'neutral',
      texture_feel:      'digital',
      typography_energy: 'neutral',
      reference_era:     'contemporary'
    },
    // Carry over any existing slides, enriching missing per-slide fields
    slides: slides.map((slide, idx) => ({
      index:         idx + 1,
      role:          slide.role          || 'concept',
      title:         slide.title         || '',
      subtitle:      slide.subtitle      || null,
      // core_message defaults to the title when absent (Stage 2 uses it for focal point guidance)
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

async function runPipeline({ rawInput, targetLanguage, fileContext, skeleton, tryModelsStage1, tryModelsStage2, tryModelsStage3, tryModels, onStageUpdate, maxSlides = 12 }) {
  // Allow legacy callers that pass a single tryModels function
  const callStage1 = tryModelsStage1 || tryModels;
  const callStage2 = tryModelsStage2 || tryModels;
  const callStage3 = tryModelsStage3 || tryModels;
  let contentJson;

  if (skeleton) {
    pipelineLog.info(ErrorCategory.PIPELINE, 'Stage 1 skipped (Skeleton provided)');
    // Enrich the editor skeleton with all fields Stage 2 needs before skipping Stage 1
    contentJson = enrichSkeletonForStage2(skeleton, rawInput);
    onStageUpdate('stage1', { status: 'done', slideCount: contentJson.slide_count || contentJson.slides?.length || 0 });
  } else {
    // ── Stage 1: Content Extraction ──
    onStageUpdate('stage1', { status: 'running' });
    
    const stage1Prompt = buildStage1Prompt(rawInput, targetLanguage);
    const stage1Raw = await runStage((p) => callStage1(p, fileContext), stage1Prompt, 'Stage 1 (Content)');
    
    try {
      contentJson = extractJson(stage1Raw);
    } catch (e) {
      throw new Error(`STAGE1_PARSE_ERROR: Could not parse Stage 1 output as JSON. Raw: ${stage1Raw.substring(0, 500)}`);
    }
    
    // Check for rejection
    if (contentJson.rejected) {
      throw new Error('CONTENT_REJECTED: ' + (contentJson.reason || 'Invalid topic'));
    }
    
    // Validate minimum fields
    if (!contentJson.slides || !Array.isArray(contentJson.slides) || contentJson.slides.length === 0) {
      throw new Error('STAGE1_INVALID: Stage 1 output has no slides array');
    }
    
    // Safety net: Forcibly trim slides array if model hallucinated past the limit to prevent token waste
    if (contentJson.slides.length > maxSlides) {
      pipelineLog.warn(ErrorCategory.VALIDATION, 'Stage 1 exceeded max slides and was trimmed', {
        maxSlides,
        receivedSlides: contentJson.slides.length
      });
      contentJson.slides = contentJson.slides.slice(0, maxSlides);
      contentJson.slide_count = maxSlides;
    }
    
    onStageUpdate('stage1', { status: 'done', slideCount: contentJson.slide_count });
    pipelineLog.info(ErrorCategory.PIPELINE, 'Stage 1 extracted content', {
      slideCount: contentJson.slide_count,
      topic: contentJson.topic,
      tone: contentJson.tone
    });
  }
  
  // ── Stage 2: Creative Direction ──
  onStageUpdate('stage2', { status: 'running' });
  
  const stage2Prompt = buildStage2Prompt(rawInput, contentJson);
  const stage2Raw = await runStage(callStage2, stage2Prompt, 'Stage 2 (Design)');
  
  let designJson;
  try {
    designJson = extractJson(stage2Raw);
  } catch (e) {
    throw new Error(`STAGE2_PARSE_ERROR: Could not parse Stage 2 output as JSON. Raw: ${stage2Raw.substring(0, 500)}`);
  }
  
  // Validate minimum fields
  if (!designJson.palette || !designJson.slides || !Array.isArray(designJson.slides)) {
    throw new Error('STAGE2_INVALID: Stage 2 output missing palette or slides');
  }
  
  onStageUpdate('stage2', { status: 'done' });
  // Support both the newer `colors_hex` array and legacy `accent_hex`/`accent2_hex` keys
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
  
  // ── Stage 3: HTML Generation (streamed) ──
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
