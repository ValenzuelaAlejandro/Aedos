const { createLogger, ErrorCategory } = require('../utils/logger');

/** @typedef {{type?: string, text: string, [key: string]: any}} StageChunk */
/** @typedef {(chunk: StageChunk) => void} StageChunkCallback */
/**
 * @typedef {object} StageRetryOptions
 * @property {Function} task - Async function that performs the stage work
 * @property {number} [maxRetries] - Additional attempts after the first
 * @property {string} stageName - Human-readable stage label
 * @property {string} stageKey - Progress event key
 * @property {Function} [onStageUpdate] - Progress callback
 */

const pipelineLog = createLogger({ scope: 'PIPELINE' });

// Safety cap per pipeline stage. In production a single Stage 2 (Design) call
// ran for 275s and streamed 0 chars (OpenRouter + gemini-2.5-flash-lite with
// reasoning effort=medium). A hard wall-clock budget turns that into a fast,
// retryable timeout instead of a minutes-long user wait. Configurable via env.
const STAGE_TIMEOUT_MS =
  (Number(process.env.STAGE_TIMEOUT_MS) > 0 ? Number(process.env.STAGE_TIMEOUT_MS) : 180000);

/**
 * Runs a non-streaming generation call against the model.
 * @param {Function} tryModelsFn - The tryModels function from server.js
 * @param {string} prompt - The prompt text
 * @param {string} stageName - For logging
 * @param {StageChunkCallback|null} [onChunk] - Optional callback invoked
 *   on every streamed token. Useful for piping reasoning tokens out to the
 *   chat SSE response without buffering the whole output first.
 * @returns {Promise<string>} The full text response
 */
// eslint-disable-next-line complexity -- preserve the pipeline's existing stream state machine verbatim
async function runStage(tryModelsFn, prompt, stageName, onChunk = null) {
  pipelineLog.info(ErrorCategory.PIPELINE, 'Stage started', { stage: stageName });
  const startTime = Date.now();

  const stageTimeoutError = () => {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    pipelineLog.warn(ErrorCategory.PIPELINE, 'Stage wall-clock timeout reached', {
      stage: stageName,
      timeoutMs: STAGE_TIMEOUT_MS,
      elapsedSeconds: Number(elapsedSeconds.toFixed(1))
    });
    return new Error(`STAGE_TIMEOUT: ${stageName} exceeded ${STAGE_TIMEOUT_MS}ms wall-clock limit`);
  };

  const result = await tryModelsFn(prompt);

  const iterator = result.stream[Symbol.asyncIterator]();
  let fullText = '';
  for (;;) {
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs > STAGE_TIMEOUT_MS) throw stageTimeoutError();

    // Race every read against the remaining time budget so a provider that
    // accepts the request but then stalls mid-stream still gets cut off.
    let next;
    try {
      next = await Promise.race([
        iterator.next(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('STAGE_TIMEOUT')), STAGE_TIMEOUT_MS - elapsedMs)
        )
      ]);
    } catch (err) {
      if (err && err.message === 'STAGE_TIMEOUT') throw stageTimeoutError();
      throw err;
    }

    if (next.done) break;
    const chunk = next.value;

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

  const elapsedSeconds = (Date.now() - startTime) / 1000;

  if (fullText.trim().length === 0) {
    // Provider returned 200 but streamed nothing usable. This was the
    // production failure mode (`STAGE2_PARSE_ERROR ... Raw: <empty>`): we
    // sent a 275s response with 0 chars into the JSON parser and then burned
    // the retries on the same slow path. Fail fast with a recognizable error.
    pipelineLog.warn(ErrorCategory.PIPELINE, 'Stage returned empty output', {
      stage: stageName,
      elapsedSeconds: Number(elapsedSeconds.toFixed(1))
    });
    throw new Error('STAGE_EMPTY_OUTPUT');
  }

  pipelineLog.success(ErrorCategory.PIPELINE, 'Stage completed', {
    stage: stageName,
    elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
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
 * @param {StageRetryOptions} options - Retry task and progress callbacks
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
      // Permanent failures: no point retrying. The user's topic was rejected,
      // or every configured provider is out of quota — retrying only multiplies
      // the wait (in production a QUOTA_EXHAUSTED attempt was retried 3×, each
      // attempt burning 5+ minutes of provider timeouts).
      if (msg.startsWith('CONTENT_REJECTED')) throw err;
      if (msg === 'QUOTA_EXHAUSTED') throw err;
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

module.exports = { runStage, runContentStageWithRetry };
