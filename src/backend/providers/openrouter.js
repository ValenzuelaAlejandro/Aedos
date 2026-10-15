const { PAID_MODELS, OUTPUT_TOKENS, estimatePaidUsd, providerPriceCeiling } = require('../config/provider-spend');
const { spendGuard } = require('../utils/spend-guard');
const { recordProviderCall } = require('./telemetry');
const { getProviderContext } = require('./request-context');
const { readProviderStream } = require('./stream-buffer');
const { readProviderError } = require('./http-error');
const HAIKU_STAGE_OUTPUT_LIMITS = Object.freeze({ Stage1: 4096, Stage3: 32768 });

function completionCost(price, usage, estimate) {
    if (Number.isFinite(usage?.cost)) return usage.cost;
    if (!Number.isFinite(usage?.prompt_tokens) || !Number.isFinite(usage?.completion_tokens)) return estimate;
    const long = usage.prompt_tokens > price.longPromptThreshold;
    return usage.prompt_tokens * (long ? price.longInput || price.input : price.input)
        + usage.completion_tokens * (long ? price.longOutput || price.output : price.output);
}

function routerFiles(files) {
    return files?.map(item => item.type === 'file' && item.file_url?.url
        ? { type: 'file', file: { filename: 'attachment.pdf', file_data: item.file_url.url } } : item);
}

/** One attempt for one exact model, with provider failover and price sorting. */
// eslint-disable-next-line max-lines-per-function -- Reservation, SSE parsing, settlement and telemetry must share one attempt lifecycle.
function createOpenRouterProvider({ fetchWithAcceptTimeout, providerAcceptTimeoutMs, reasoningForStage, providerLog, guard = spendGuard }) {
    // eslint-disable-next-line complexity -- HTTP, stream, cost and terminal telemetry share one attempt lifetime.
    async function call(prompt, stageName, models, fileContext = null, options = {}) {
        const model = models?.[0], price = PAID_MODELS[model];
        const started = Date.now();
        let handedOff = false, completed = false;
        let usage, finishReason, failure, reservation, estimate = 0, accepted = false, rejected = false, sent = false;
        let respondingProvider = null;
        try {
            if (!process.env.OPENROUTER_API_KEY || !price || models.length !== 1) throw new Error('PROVIDER_UNAVAILABLE');
            const maxTokens = Math.min(OUTPUT_TOKENS[stageName], price.maxOutputTokens,
                model.startsWith('anthropic/claude-haiku') ? HAIKU_STAGE_OUTPUT_LIMITS[stageName] || Infinity : Infinity,
                options.maxOutputTokens || Infinity);
            estimate = estimatePaidUsd(model, prompt, fileContext, maxTokens);
            if (!Number.isFinite(estimate)) throw new Error('PROVIDER_UNPRICED_INPUT');
            reservation = await guard.reserve(estimate, { provider: 'openrouter', model,
                requestId: getProviderContext().requestId });
            if (!reservation?.allowed) {
                const code = ['REQUEST_SPEND_LIMIT', 'IP_SPEND_LIMIT', 'REQUEST_ATTEMPT_LIMIT', 'REQUEST_TIMEOUT']
                    .includes(reservation?.reason) ? reservation.reason
                    : reservation?.reason === 'SPEND_GUARD_UNAVAILABLE' ? 'SPEND_GUARD_UNAVAILABLE' : 'PAID_PAUSED';
                throw new Error(code);
            }
            const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
            const body = { model, messages: [{ role: 'user', content: fileContext?.length ? [...routerFiles(fileContext), { type: 'text', text }] : text }],
                stream: true, max_tokens: maxTokens, stream_options: { include_usage: true },
                provider: { sort: 'price', allow_fallbacks: true, require_parameters: true, max_price: providerPriceCeiling(model, prompt, fileContext) },
                reasoning: reasoningForStage(stageName, model) };
            if (options.providerSelection?.providerOnly) body.provider.only = options.providerSelection.providerOnly;
            sent = true;
            const response = await fetchWithAcceptTimeout('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST', signal: options.signal || getProviderContext().signal,
                headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.APP_URL || 'https://aedos.app', 'X-Title': 'Aedos' }, body: JSON.stringify(body)
            }, providerAcceptTimeoutMs, 'OPENROUTER_ACCEPT_TIMEOUT');
            if (!response.ok) {
                rejected = true;
                const details = await readProviderError(response);
                const billing = /insufficient.?credits|payment.required|not.enough.credits/i.test(JSON.stringify(details?.error || {}));
                if (response.status === 402 || billing) { await guard.pausePaid?.(); throw new Error('PAID_PAUSED'); }
                if (response.status === 403) throw new Error('PROVIDER_SAFETY');
                throw new Error(`OPENROUTER_HTTP_${response.status}`);
            }
            accepted = true;
            const source = readProviderStream(response, { provider: 'openrouter', includeReasoning: options.includeReasoning,
                signal: options.signal || getProviderContext().signal,
                idleTimeoutMs: options.streamIdleTimeoutMs, totalTimeoutMs: options.streamTotalTimeoutMs,
                onMetadata(frame) {
                    if (frame.usage) usage = frame.usage;
                    if (frame.provider) respondingProvider = frame.provider;
                    if (frame.model && frame.model !== model && !frame.model.startsWith(`${model}-20`)) throw new Error('PROVIDER_MODEL_MISMATCH');
                    if (frame.choices?.[0]?.finish_reason) finishReason = frame.choices[0].finish_reason;
                } });
            async function* stream() {
                try { yield* source; completed = true; }
                catch (error) { failure = error; throw error; }
                finally { await finish(); }
            }
            handedOff = true;
            return { stream: stream(), provider: 'openrouter', model };
        } catch (error) { failure = error; throw error; }
        finally { if (!handedOff) await finish(); }
        // eslint-disable-next-line complexity -- Reservation, usage and terminal telemetry settle together.
        async function finish() {
            const cost = rejected || !sent ? 0 : completionCost(price || {}, usage, estimate);
            if (reservation?.allowed && cost > reservation.amount / 1_000_000) providerLog?.warn('PROVIDER', 'OpenRouter actual cost exceeded spend reservation', {
                requestId: getProviderContext().requestId, model, reservedUsd: reservation.amount / 1_000_000, actualUsd: cost, overageUsd: cost - reservation.amount / 1_000_000
            });
            if (reservation?.allowed) {
                if (rejected) await guard.release(reservation);
                else await guard.settle(reservation, cost);
            }
            await recordProviderCall({ stage: stageName, provider: 'openrouter', respondingProvider, model,
                prompt_tokens: usage?.prompt_tokens ?? null, completion_tokens: usage?.completion_tokens ?? null,
                reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens ?? null,
                cost_usd: cost, cost_estimated: !usage && !rejected,
                finish_reason: finishReason || failure?.message,
                requestedModelId: options.modelRoute?.requestedModelId, effectiveModelId: model,
                fallbackReason: options.modelRoute?.fallbackReason, errorCode: failure?.message,
                outcome: failure ? (accepted ? 'stream_failed' : 'request_failed') : completed ? 'complete' : 'cancelled',
                duration_ms: Date.now() - started, retry: options.retry || 0, route: 'paid' });
        }
    }
    return { call };
}

module.exports = { createOpenRouterProvider };
