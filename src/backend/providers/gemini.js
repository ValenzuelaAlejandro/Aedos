const { OUTPUT_TOKENS, PAID_MODELS, estimatePaidUsd } = require('../config/provider-spend');
const { spendGuard } = require('../utils/spend-guard');
const { recordProviderCall } = require('./telemetry');
const { getProviderContext } = require('./request-context');
const { readProviderStream } = require('./stream-buffer');

/** Preserve document contents on both provider routes, including extracted text. */
function toGeminiParts(prompt, files) {
    const parts = [];
    for (const item of files || []) {
        if (item.type === 'text') parts.push({ text: item.text });
        else {
            const url = item.image_url?.url || item.file_url?.url;
            const match = url?.match(/^data:([^;]+);base64,(.+)$/);
            if (match && (match[1].startsWith('image/') || match[1] === 'application/pdf')) {
                parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
        }
    }
    parts.push({ text: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) });
    return parts;
}

/** One direct Gemini attempt; the selected-model router owns the retry budget. */
function createGeminiProvider({ fetchWithAcceptTimeout, providerAcceptTimeoutMs, guard = spendGuard }) {
    // eslint-disable-next-line complexity -- Reserve, streaming, settlement and telemetry form one provider-attempt lifecycle.
    async function call(prompt, stageName, model, fileContext = null, options = {}) {
        const started = Date.now();
        let handedOff = false, completed = false;
        let usage, finishReason, failure, accepted = false, sent = false, rejected = false, reservation, estimate = 0;
        try {
            if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_KEY_MISSING');
            const maxOutputTokens = Math.min(OUTPUT_TOKENS[stageName], options.maxOutputTokens || Infinity);
            estimate = estimatePaidUsd(options.modelRoute?.requestedModelId || 'google/gemini-3-flash-preview',
                prompt, fileContext, maxOutputTokens);
            reservation = await guard.reserve(estimate, { provider: 'gemini', model,
                requestId: getProviderContext().requestId });
            if (!reservation?.allowed) {
                const code = ['REQUEST_SPEND_LIMIT', 'IP_SPEND_LIMIT', 'REQUEST_ATTEMPT_LIMIT', 'REQUEST_TIMEOUT']
                    .includes(reservation?.reason) ? reservation.reason
                    : reservation?.reason === 'SPEND_GUARD_UNAVAILABLE' ? 'SPEND_GUARD_UNAVAILABLE' : 'PAID_PAUSED';
                throw new Error(code);
            }
            if (!(await guard.reserveGeminiRequest())) {
                await guard.release(reservation); reservation = null;
                throw new Error('GEMINI_APP_CAP_REACHED');
            }
            const generationConfig = { maxOutputTokens };
            if (model.startsWith('gemini-3')) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
            else if (options.includeReasoning) generationConfig.thinkingConfig = { thinkingBudget: 1024 };
            sent = true;
            const response = await fetchWithAcceptTimeout(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    signal: options.signal || getProviderContext().signal,
                    body: JSON.stringify({ contents: [{ role: 'user', parts: toGeminiParts(prompt, fileContext) }], generationConfig }) },
                providerAcceptTimeoutMs, 'GEMINI_ACCEPT_TIMEOUT');
            if (!response.ok) {
                rejected = true;
                await response.body?.cancel();
                throw new Error(`GEMINI_HTTP_${response.status}`);
            }
            accepted = true;
            const source = readProviderStream(response, {
                provider: 'gemini', includeReasoning: options.includeReasoning,
                signal: options.signal || getProviderContext().signal,
                idleTimeoutMs: options.streamIdleTimeoutMs, totalTimeoutMs: options.streamTotalTimeoutMs,
                onMetadata(frame) {
                    if (frame.usageMetadata) usage = frame.usageMetadata;
                    if (frame.candidates?.[0]?.finishReason) finishReason = frame.candidates[0].finishReason;
                }
            });
            async function* stream() {
                try { yield* source; completed = true; }
                catch (error) { failure = error; throw error; }
                finally { await finish(); }
            }
            handedOff = true;
            return { stream: stream(), provider: 'gemini', model };
        } catch (error) { failure = error; throw error; }
        finally { if (!handedOff) await finish(); }
        // eslint-disable-next-line complexity -- Usage and outcome fields depend on the same attempt lifetime.
        async function finish() {
            const publicModel = options.modelRoute?.requestedModelId || 'google/gemini-3-flash-preview';
            const price = PAID_MODELS[publicModel];
            const cost = !sent || rejected ? 0 : usage && price
                ? (usage.promptTokenCount || 0) * price.input + ((usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0)) * price.output
                : estimate;
            if (reservation?.allowed) await guard.settle(reservation, cost);
            await recordProviderCall({ stage: stageName, provider: 'gemini', model,
                prompt_tokens: usage?.promptTokenCount ?? null, completion_tokens: usage?.candidatesTokenCount ?? null,
                reasoning_tokens: usage?.thoughtsTokenCount ?? null, cost_usd: cost,
                cost_estimated: !usage, cost_basis: usage ? 'reported_usage_list_price' : 'bounded_token_estimate',
                requestedModelId: options.modelRoute?.requestedModelId,
                effectiveModelId: options.modelRoute?.effectiveModelId || model,
                fallbackReason: options.modelRoute?.fallbackReason,
                finish_reason: finishReason || (failure ? failure.message : null),
                outcome: failure ? (accepted ? 'stream_failed' : 'request_failed') : completed ? 'complete' : 'cancelled',
                errorCode: failure?.message, duration_ms: Date.now() - started, retry: options.retry || 0, route: 'direct' });
        }
    }
    return { call };
}

module.exports = { createGeminiProvider };
