/* eslint-disable max-lines-per-function, complexity */
const { formatSseEvent } = require('../contracts/sse');
/**
 * @typedef {object} StreamDependencies
 * @property {Function} tryModelsFlash flash provider caller
 * @property {Function} buildPrompt legacy flash prompt builder
 * @property {object} log scoped logger
 * @property {Record<string, string>} ErrorCategory logger categories
 */

/**
 * Consume a provider stream and forward the existing SSE chunks.
 * @param {{[key: string]: any}} deps stream dependencies
 * @param {{provider?: string, model?: string, stream: AsyncIterable<any>}} streamResult provider result
 * @param {import('express').Response} res response
 * @param {string} requestId request identifier
 * @param {Function} cancelledRef cancellation predicate
 * @param {number} slideHardLimit slide limit
 * @returns {Promise<{fullHtml: string, hasStartedValidContent: boolean, streamSlideCount: number}>}
 */
async function consumeModelStream(deps, streamResult, res, requestId, cancelledRef, slideHardLimit) {
    const { log, ErrorCategory } = deps;
    let fullHtml = '';
    let hasStartedValidContent = false;
    let streamSlideCount = 0;
    const maxStreamChars = 2_000_000;
    const slideTagRegex = /<section[^>]*\bclass="[^"]*\bs\b[^"]*"[^>]*>/gi;

    function cleanSSEChunk(text) {
        let c = text.replace(/```html\n?/g, '').replace(/```\n?/g, '');
        c = c.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        c = c.replace(/<script[^>]*>/gi, '');
        c = c.replace(/<script\b[^>]*/gi, '');
        c = c.replace(/<\/script>/gi, '');
        c = c.replace(/<link[^>]*\/?>/gi, '');
        c = c.replace(/<link\b[^>]*/gi, '');
        return c;
    }

    if (streamResult.provider && streamResult.model) {
        res.write(formatSseEvent({ metadata: { provider: streamResult.provider, model: streamResult.model } }));
    }

    for await (const item of streamResult.stream) {
            if (cancelledRef()) {
                log.warn(ErrorCategory.STREAM, 'Generation loop stopped because client disconnected', { requestId });
                break;
            }
            if (res.writableEnded || res.destroyed) break;

            let chunkText = null;
            if (item && typeof item === 'object' && typeof item.text === 'string') {
                if (item.type === 'reasoning') {
                    try {
                        res.write(formatSseEvent({ reasoning: item.text }));
                    } catch (_) { /* ignore broken pipe mid-write */ }
                    continue;
                }
                chunkText = item.text;
            } else if (typeof item === 'string') {
                chunkText = item;
            }
            if (!chunkText) continue;

            const matches = chunkText.match(slideTagRegex);
            if (matches) {
                streamSlideCount += matches.length;
                if (streamSlideCount > slideHardLimit) {
                    log.warn(ErrorCategory.VALIDATION, 'Stream exceeded slide hard limit, stopping generation', {
                        requestId,
                        streamSlideCount,
                        slideHardLimit
                    });
                    break;
                }
            }

            fullHtml += chunkText;
            if (fullHtml.length > maxStreamChars) {
                log.warn(ErrorCategory.VALIDATION, 'Generation stream exceeded HTML size limit', {
                    requestId,
                    maxStreamChars
                });
                throw new Error('GENERATION_OUTPUT_TOO_LARGE');
            }

            let cleanChunk = cleanSSEChunk(chunkText);
            if (!hasStartedValidContent) {
                const matchIdx = fullHtml.indexOf('<!-- CONFIG');
                const htmlIdx = fullHtml.indexOf('<html');
                if (matchIdx !== -1) {
                    hasStartedValidContent = true;
                    cleanChunk = cleanSSEChunk(fullHtml.substring(matchIdx));
                    res.write(formatSseEvent({ chunk: cleanChunk }));
                } else if (htmlIdx !== -1) {
                    hasStartedValidContent = true;
                    cleanChunk = cleanSSEChunk(fullHtml.substring(htmlIdx));
                    res.write(formatSseEvent({ chunk: cleanChunk }));
                } else if (fullHtml.length > 500) {
                    hasStartedValidContent = true;
                    cleanChunk = cleanSSEChunk(fullHtml);
                    res.write(formatSseEvent({ chunk: cleanChunk }));
                }
            } else {
                res.write(formatSseEvent({ chunk: cleanChunk }));
            }
    }
    return { fullHtml, hasStartedValidContent, streamSlideCount };
}

/**
 * Run the Flash stream with its existing retry-on-missing-CSS semantics.
 * @param {{[key: string]: any}} deps flash dependencies
 * @returns {Promise<{result: object, fullHtml: string, hasStartedValidContent: boolean}>} provider result and consumed HTML
 */
async function runFlashGenerationWithRetry(deps) {
    const {
        cancelledRef, res, requestId, opciones, fileContext, slideHardLimit,
        tryModelsFlash, buildPrompt, log, ErrorCategory, consumeStream
    } = deps;
    const FLASH_MAX_RETRIES = 2;
    let lastError;
    for (let attempt = 1; attempt <= FLASH_MAX_RETRIES + 1; attempt++) {
        if (cancelledRef()) throw new Error('GENERATION_CANCELLED');
        if (attempt > 1) {
            res.write(formatSseEvent({
                pipeline: true,
                stage: 'flash',
                status: 'retrying',
                attempt: attempt - 1,
                maxAttempts: FLASH_MAX_RETRIES + 1,
                error: lastError ? lastError.message : 'AI returned bad output'
            }));
            await new Promise(r => setTimeout(r, 500 * (attempt - 1)));
            if (cancelledRef()) throw new Error('GENERATION_CANCELLED');
        }

        const prompt = buildPrompt(opciones);
        log.info(ErrorCategory.PIPELINE,
            `Running flash generation path (attempt ${attempt}/${FLASH_MAX_RETRIES + 1})`, { requestId });
        const flashResult = await tryModelsFlash(prompt, fileContext);
        const consumed = await consumeStream(flashResult, res, requestId, cancelledRef, slideHardLimit);
        const fullHtml = consumed.fullHtml;
        const hasDesignCss = /<style[\s\S]*?section\.s[\s\S]*?<\/style>/i.test(fullHtml)
            || /<style[\s\S]*?--bg[\s\S]*?<\/style>/i.test(fullHtml);
        if (!hasDesignCss) {
            lastError = new Error('FLASH_NO_DESIGN_CSS: The AI generated a presentation without design CSS');
            log.warn(ErrorCategory.PIPELINE,
                `Flash attempt ${attempt}/${FLASH_MAX_RETRIES + 1}: no design CSS in output`, {
                requestId,
                outputChars: fullHtml.length
            });
            if (attempt > FLASH_MAX_RETRIES) throw lastError;
            continue;
        }
        return { result: flashResult, fullHtml, hasStartedValidContent: consumed.hasStartedValidContent };
    }
    throw lastError;
}

module.exports = { consumeModelStream, runFlashGenerationWithRetry };
