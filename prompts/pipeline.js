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
  console.log(`[Pipeline] Starting ${stageName}...`);
  const startTime = Date.now();
  
  const result = await tryModelsFn(prompt);
  
  // Collect the full streamed response
  let fullText = '';
  for await (const chunk of result.stream) {
    try {
      if (chunk.candidates && chunk.candidates[0]?.content?.parts[0]?.text) {
        fullText += chunk.text();
      }
    } catch (e) {
      // Skip non-text chunks
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Pipeline] ${stageName} completed in ${elapsed}s (${fullText.length} chars)`);
  
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
 * @returns {object} { stage3Stream, contentJson, designJson } - stage3Stream is the async iterable
 */
async function runPipeline({ rawInput, tryModelsStage1, tryModelsStage2, tryModelsStage3, tryModels, onStageUpdate }) {
  // Allow legacy callers that pass a single tryModels function
  const callStage1 = tryModelsStage1 || tryModels;
  const callStage2 = tryModelsStage2 || tryModels;
  const callStage3 = tryModelsStage3 || tryModels;
  // ── Stage 1: Content Extraction ──
  onStageUpdate('stage1', { status: 'running' });
  
  const stage1Prompt = buildStage1Prompt(rawInput);
  const stage1Raw = await runStage(callStage1, stage1Prompt, 'Stage 1 (Content)');
  
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
  
  onStageUpdate('stage1', { status: 'done', slideCount: contentJson.slide_count });
  console.log(`[Pipeline] Stage 1 extracted: ${contentJson.slide_count} slides, topic="${contentJson.topic}", tone="${contentJson.tone}"`);
  
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
  console.log(`[Pipeline] Stage 2 resolved: palette=${designJson.palette.accent_hex}/${designJson.palette.accent2_hex}, font=${designJson.font_pair}, mood="${designJson.mood_global}"`);
  
  // ── Stage 3: HTML Generation (streamed) ──
  onStageUpdate('stage3', { status: 'running' });
  
  const stage3Prompt = buildStage3Prompt(rawInput, contentJson, designJson);
  console.log(`[Pipeline] Starting Stage 3 (HTML Compositor) — waiting 2.5s for rate limit reset...`);
  await new Promise(r => setTimeout(r, 2500));
  console.log(`[Pipeline] Starting Stage 3 (HTML Compositor) — streaming...`);
  
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
