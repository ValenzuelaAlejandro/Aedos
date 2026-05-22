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
 * Extracts JSON from a model response that may contain markdown fences or extra text.
 * @param {string} text - Raw model output
 * @returns {object} Parsed JSON
 */
function extractJson(text) {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch (_) {
    // Strip markdown code fences
    let cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    
    // Find the first { and last }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    // Strip JS-style // line comments (model sometimes copies comment syntax from prompt examples)
    cleaned = cleaned.replace(/\/\/[^\n"]*/g, '');

    return JSON.parse(cleaned);
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
async function runPipeline({ rawInput, targetLanguage, fileContext, tryModelsStage1, tryModelsStage2, tryModelsStage3, tryModels, onStageUpdate, maxSlides = 12 }) {
  // Allow legacy callers that pass a single tryModels function
  const callStage1 = tryModelsStage1 || tryModels;
  const callStage2 = tryModelsStage2 || tryModels;
  const callStage3 = tryModelsStage3 || tryModels;
  // ── Stage 1: Content Extraction ──
  onStageUpdate('stage1', { status: 'running' });
  
  const stage1Prompt = buildStage1Prompt(rawInput, targetLanguage);
  const stage1Raw = await runStage((p) => callStage1(p, fileContext), stage1Prompt, 'Stage 1 (Content)');
  
  let contentJson;
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
    waitMs: 2500
  });
  await new Promise(r => setTimeout(r, 2500));
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
