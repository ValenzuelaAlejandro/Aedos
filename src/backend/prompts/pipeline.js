const buildStage1 = require('./stage1-content');
const buildStage2Prompt = require('./stage2-design');
const buildStage3Prompt = require('./stage3-compositor');
const { createLogger, ErrorCategory } = require('../utils/logger');
const { extractJson } = require('./json-extraction');
const { runStage, runContentStageWithRetry } = require('./stage-runner');
const enrichSkeletonForStage2 = require('./skeleton-enrichment');
const { completeOutlineSlides } = require('../pipeline/outline-completion');

const pipelineLog = createLogger({ scope: 'PIPELINE' });

async function generateContent({ rawInput, targetLanguage, requestedSlides, callStage1, fileContext, onChunk }) {
  const prompt = buildStage1.buildStage1Prompt(rawInput, targetLanguage, requestedSlides);
  const raw = await runStage(
    (value) => callStage1(value, fileContext, { expectedOutput: 'outline', expectedSlides: requestedSlides }),
    prompt, 'Stage 1 (Content)', onChunk
  );
  let parsed;
  try { parsed = extractJson(raw); }
  catch (cause) { throw new Error('STAGE1_PARSE_ERROR: Could not parse Stage 1 output as JSON.', { cause }); }
  if (parsed.rejected) throw new Error('CONTENT_REJECTED: ' + (parsed.reason || 'Invalid topic'));
  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('STAGE1_INVALID: Stage 1 output has no slides array');
  }
  return completeOutlineSlides({ contentJson: parsed, requestedSlides, rawInput, targetLanguage,
    callModel: callStage1, fileContext, extractJson, selectedModel: undefined, onChunk });
}

async function generateDesign(rawInput, contentJson, callStage2, onChunk) {
  const prompt = buildStage2Prompt(rawInput, contentJson);
  const raw = await runStage((value) => callStage2(value, null), prompt, 'Stage 2 (Design)', onChunk);
  let parsed;
  try { parsed = extractJson(raw); }
  catch (cause) { throw new Error('STAGE2_PARSE_ERROR: Could not parse Stage 2 output as JSON.', { cause }); }
  if (!parsed.palette || !Array.isArray(parsed.slides)) {
    throw new Error('STAGE2_INVALID: Stage 2 output missing palette or slides');
  }
  return parsed;
}

/**
 * Runs the full 3-stage pipeline.
 * 
 * @param {object} options
 * @param {string} options.rawInput - The sanitized user prompt
 * @param {string} [options.targetLanguage] - The selected output language
 * @param {any} [options.fileContext] - Optional source attachments
 * @param {any} [options.skeleton] - An approved outline to render
 * @param {number} [options.requestedSlides=8] - Exact requested slide count
 * @param {Function} options.tryModelsStage1 - Caller for Stage 1 (Content)
 * @param {Function} options.tryModelsStage2 - Caller for Stage 2 (Design)
 * @param {Function} options.tryModelsStage3 - Caller for Stage 3 (HTML)
 * @param {Function} [options.tryModels] - Legacy fallback if stage-specific callers not provided
 * @param {Function} options.onStageUpdate - Callback for progress updates: (stage, data) => void
 * @param {Function} [options.onChunk] - Live reasoning/content callback
 * @param {number} [options.maxSlides=12] - Hard limit on slides to prevent token waste
 * @returns {Promise<object>} { stage3Stream, contentJson, designJson } - stage3Stream is the async iterable
 */
async function runPipeline({ rawInput, targetLanguage, fileContext, skeleton, requestedSlides = 8, tryModelsStage1, tryModelsStage2, tryModelsStage3, tryModels, onStageUpdate, onChunk, maxSlides = 12 }) {
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
    contentJson = await completeOutlineSlides({ contentJson, requestedSlides, rawInput, targetLanguage,
      callModel: callStage1, fileContext, extractJson, selectedModel: undefined, onChunk: stageChunk('stage1') });
    onStageUpdate('stage1', { status: 'done', slideCount: contentJson.slide_count || contentJson.slides?.length || 0 });
  } else {
    onStageUpdate('stage1', { status: 'running' });

    contentJson = await runContentStageWithRetry({
      stageName: 'Stage 1 (Content)',
      stageKey: 'stage1',
      maxRetries: 1,
      onStageUpdate,
      task: () => generateContent({ rawInput, targetLanguage, requestedSlides,
        callStage1, fileContext, onChunk: stageChunk('stage1') })
    });

    onStageUpdate('stage1', { status: 'done', slideCount: contentJson.slide_count });
    pipelineLog.info(ErrorCategory.PIPELINE, 'Stage 1 extracted content', {
      slideCount: contentJson.slide_count,
      topic: contentJson.topic,
      tone: contentJson.tone
    });
  }

  onStageUpdate('stage2', { status: 'running' });

  /** @type {any} */
  const designJson = await runContentStageWithRetry({
    stageName: 'Stage 2 (Design)',
    stageKey: 'stage2',
    maxRetries: 1,
    onStageUpdate,
    task: () => generateDesign(rawInput, contentJson, callStage2, stageChunk('stage2'))
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
  
  const stage3Stream = await callStage3(stage3Prompt, null);
  
  return {
    stage3Stream,
    contentJson,
    designJson,
    stage3Prompt
  };
}

module.exports = {
  runPipeline,
  extractJson
};
