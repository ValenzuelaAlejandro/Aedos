const { resolveModelId } = require('../config/model-catalog');
const { getProviderContext } = require('./request-context');
const { setTimeout: delay } = require('node:timers/promises');

// eslint-disable-next-line complexity -- Ordered provider errors map to stable, low-cardinality diagnostics.
function fallbackReasonFor(error) {
    if (error?.fallbackReason) return error.fallbackReason;
    const message = error?.message || '';
    if (message === 'PROVIDER_SAFETY') return 'safety';
    if (message === 'PAID_PAUSED' || message === 'SPEND_GUARD_UNAVAILABLE') return 'global_spend_limit';
    if (message === 'IP_SPEND_LIMIT') return 'ip_spend_limit';
    if (message === 'REQUEST_SPEND_LIMIT') return 'request_spend_limit';
    if (message === 'REQUEST_ATTEMPT_LIMIT') return 'request_attempt_limit';
    if (message === 'PROVIDER_REQUEST_TIMEOUT') return 'request_timeout';
    if (message === 'GEMINI_APP_CAP_REACHED') return 'gemini_quota_exhausted';
    if (/TIMEOUT/.test(message)) return 'timeout';
    if (/HTTP_429/.test(message)) return 'rate_limited';
    if (/HTTP_5\d\d/.test(message)) return 'provider_5xx';
    if (message === 'PROVIDER_EMPTY_RESPONSE') return 'empty_response';
    if (message === 'PROVIDER_INVALID_OUTPUT') return 'invalid_output';
    if (/INCOMPLETE|STREAM|MALFORMED/.test(message)) return 'stream_failed';
    return 'provider_unavailable';
}

function resultWithRoute(result, modelRoute) { return { ...result, modelRoute }; }

/** Live attempts share one stream and use explicit resets before a same-model retry. */
function createSelectedModelRouter({ gemini, openrouter, getOverride, createStub, validateOutput = null,
    providerLog, ErrorCategory, sleep = (ms, signal) => delay(ms, undefined, { signal }),
    shouldUseTestStub = () => process.env.NODE_ENV === 'test' && process.env.AEDOS_TEST_STUB_PROVIDERS === '1' }) {
    function makeCaller(stageName, geminiModel, openrouterModels) {
        return async (prompt, fileContext = null, options = {}) => {
            if (shouldUseTestStub()) {
                const override = getOverride?.();
                return override ? override({ prompt, stageName, geminiModel, openrouterModels, fileContext, options }) : createStub(stageName, options);
            }
            const selection = resolveModelId(options.selectedModel?.id || getProviderContext().requestedModelId);
            if (!selection.valid) throw new Error('MODEL_NOT_ALLOWED');
            const selected = selection.model;
            const signal = options.signal || getProviderContext().signal;
            const routes = selected.provider === 'gemini' ? ['gemini', 'openrouter', 'openrouter'] : ['openrouter', 'openrouter', 'openrouter'];
            const response = { provider: routes[0], model: selected.id,
                modelRoute: { requestedModelId: selected.id, effectiveModelId: selected.id, fallbackReason: null }, stream: null };
            // eslint-disable-next-line complexity -- Keep the bounded retry and reset lifecycle in one generator.
            async function* stream() {
                let reason = null, lastError, safetyAttempt = -1;
                for (const [attempt, provider] of routes.entries()) {
                    signal?.throwIfAborted();
                    if (safetyAttempt >= 0 && attempt > safetyAttempt + 1) break;
                    if (attempt && safetyAttempt < 0) await sleep(500 * 2 ** (attempt - 1), signal);
                    const modelRoute = { requestedModelId: selected.id, effectiveModelId: selected.id, fallbackReason: reason };
                    const attemptOptions = { ...options, signal, selectedModel: selected, retry: attempt, modelRoute,
                        providerSelection: selected, maxOutputTokens: Math.min(selected.outputMaxTokens,
                            options.maxOutputTokens || selected.outputMaxTokens) };
                    try {
                        const result = provider === 'gemini'
                            ? await gemini(prompt, stageName, selected.providerModelId, fileContext, attemptOptions)
                            : await openrouter(prompt, stageName, [selected.id], fileContext, attemptOptions);
                        response.provider = result.provider;
                        response.modelRoute = modelRoute;
                        yield { type: 'metadata', provider: result.provider, model: selected.id, stage: stageName, attempt };
                        let content = '';
                        for await (const chunk of result.stream) {
                            if (typeof chunk === 'string') content += chunk;
                            else if (chunk?.type !== 'reasoning') content += chunk?.text || '';
                            yield chunk;
                        }
                        if (validateOutput) validateOutput(stageName, content, options);
                        return;
                    } catch (error) {
                        lastError = error;
                        if (signal?.aborted) {
                            if (signal.reason?.message === 'REQUEST_TOTAL_TIMEOUT') {
                                yield { type: 'reset', stage: stageName, attempt: attempt + 1, reason: 'request_timeout' };
                                throw new Error('PROVIDER_REQUEST_TIMEOUT', { cause: error });
                            }
                            throw error;
                        }
                        if (error.message === 'PROVIDER_CANCELLED') throw error;
                        reason = fallbackReasonFor(error);
                        if (reason === 'safety' && safetyAttempt < 0) safetyAttempt = attempt;
                        providerLog.warn(ErrorCategory.PROVIDER, 'Selected-model attempt failed', {
                            requestId: getProviderContext().requestId, stage: stageName, requestedModelId: selected.id,
                            provider, attempt, fallbackReason: reason
                        });
                        if (['PAID_PAUSED', 'IP_SPEND_LIMIT', 'REQUEST_SPEND_LIMIT', 'REQUEST_ATTEMPT_LIMIT',
                            'REQUEST_TIMEOUT', 'SPEND_GUARD_UNAVAILABLE'].includes(error.message)) break;
                        if (attempt + 1 < routes.length && (safetyAttempt < 0 || attempt < safetyAttempt + 1)) {
                            yield { type: 'reset', stage: stageName, attempt: attempt + 1, reason };
                        }
                    }
                }
                const code = safetyAttempt >= 0 ? 'PROVIDER_SAFETY'
                    : ['PAID_PAUSED', 'IP_SPEND_LIMIT', 'REQUEST_SPEND_LIMIT', 'REQUEST_ATTEMPT_LIMIT',
                        'REQUEST_TIMEOUT', 'SPEND_GUARD_UNAVAILABLE'].includes(lastError?.message)
                        ? lastError.message : 'PROVIDER_UNAVAILABLE';
                throw Object.assign(new Error(code, { cause: lastError }), { fallbackReason: reason });
            }
            response.stream = stream();
            return response;
        };
    }
    return { makeCaller };
}

module.exports = { createSelectedModelRouter, fallbackReasonFor, resultWithRoute };
