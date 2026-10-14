'use strict';

const { FREE_MODELS } = require('../config/provider-spend');
const { MODEL_CATALOG } = require('../config/model-catalog');

function route(requestedModelId, effectiveModelId, fallbackReason = null) {
    return { requestedModelId, effectiveModelId, fallbackReason };
}

function resultWithRoute(result, modelRoute) {
    if (!result) return result;
    const effectiveModelId = result.provider === 'openrouter' && result.model
        ? result.model
        : modelRoute.effectiveModelId;
    return { ...result, modelRoute: { ...modelRoute, effectiveModelId } };
}

function fallbackReasonFor(error) {
    if (error?.fallbackReason) return error.fallbackReason;
    const message = error?.message || '';
    if (message === 'PAID_PAUSED') return 'paid_paused';
    if (message === 'GEMINI_APP_CAP_REACHED') return 'gemini_quota_exhausted';
    if (message === 'GEMINI_ACCEPT_TIMEOUT' || message === 'OPENROUTER_ACCEPT_TIMEOUT') return 'timeout';
    if (/HTTP_429/.test(message)) return 'rate_limited';
    if (/HTTP_5\d\d/.test(message)) return 'provider_5xx';
    return 'provider_unavailable';
}

async function fallbackToFree({ gemini, openrouter, providerLog, ErrorCategory, stageName,
    geminiModel, selectedModel, requestedModelId, prompt, options, reason, hasGeminiKey }) {
    const failures = [];
    if (hasGeminiKey() && selectedModel.providerModelId !== geminiModel) {
        const geminiEntry = Object.values(MODEL_CATALOG).find(item => item.provider === 'gemini'
            && item.providerModelId === geminiModel);
        const geminiRoute = route(requestedModelId, geminiEntry?.id || geminiModel, reason);
        try {
            const result = await gemini(prompt, stageName, geminiModel, null, { ...options, modelRoute: geminiRoute });
            providerLog.warn(ErrorCategory.PROVIDER, 'Selected model fell back to Gemini', {
                stage: stageName, requestedModelId, effectiveModelId: geminiRoute.effectiveModelId, fallbackReason: reason
            });
            return resultWithRoute(result, geminiRoute);
        } catch (error) {
            failures.push(fallbackReasonFor(error));
        }
    }

    const fallbackModels = FREE_MODELS.filter(model => model !== selectedModel.providerModelId);
    if (fallbackModels.length) {
        const freeRoute = route(requestedModelId, fallbackModels[0], reason);
        try {
            const result = await openrouter(prompt, stageName, fallbackModels, null, { ...options, modelRoute: freeRoute });
            providerLog.warn(ErrorCategory.PROVIDER, 'Selected model fell back to approved OpenRouter free model', {
                stage: stageName, requestedModelId,
                effectiveModelId: result.model || fallbackModels[0], fallbackReason: reason
            });
            return resultWithRoute(result, freeRoute);
        } catch (error) {
            failures.push(fallbackReasonFor(error));
        }
    }

    throw Object.assign(new Error(failures.includes('paid_paused') ? 'PAID_PAUSED' : 'PROVIDER_UNAVAILABLE'), {
        fallbackReason: reason
    });
}

function createSelectedModelRouter({ gemini, openrouter, nvidia, makeBaseCaller, getOverride, createStub, providerLog,
    ErrorCategory, hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY),
    shouldUseTestStub = () => process.env.NODE_ENV === 'test' && process.env.AEDOS_TEST_STUB_PROVIDERS === '1' }) {
    function makeCaller(stageName, geminiModel, openrouterModels) {
        const baseCaller = makeBaseCaller(stageName, geminiModel, openrouterModels);
        return async (prompt, fileContext = null, options = {}) => {
            const testOverride = getOverride?.();
            if (shouldUseTestStub() && testOverride) {
                return testOverride({ prompt, stageName, geminiModel, openrouterModels, fileContext, options });
            }
            if (shouldUseTestStub()) {
                return createStub(stageName, options);
            }
            const selectedModel = options.selectedModel;
            if (!selectedModel) return baseCaller(prompt, fileContext, options);
            const requestedModelId = selectedModel.id;
            const initialRoute = route(requestedModelId, requestedModelId);

            try {
                const result = selectedModel.provider === 'gemini'
                    ? await gemini(prompt, stageName, selectedModel.providerModelId, fileContext,
                        { ...options, modelRoute: initialRoute })
                    : selectedModel.provider === 'nvidia'
                        ? await nvidia(prompt, stageName, selectedModel, { ...options, modelRoute: initialRoute })
                        : await openrouter(prompt, stageName, [selectedModel.providerModelId], fileContext, {
                        ...options,
                        modelRoute: initialRoute,
                        providerSelection: selectedModel,
                        maxOutputTokens: selectedModel.outputMaxTokens
                    });
                return resultWithRoute(result, initialRoute);
            } catch (error) {
                // NVIDIA Build is an explicit local trial selection; do not silently spend Gemini or OpenRouter quota.
                if (selectedModel.provider === 'nvidia') {
                    throw Object.assign(new Error('PROVIDER_UNAVAILABLE', { cause: error }), {
                        fallbackReason: fallbackReasonFor(error)
                    });
                }
                const reason = fallbackReasonFor(error);
                providerLog.warn(ErrorCategory.PROVIDER, 'Selected model failed; trying free fallback', {
                    stage: stageName, requestedModelId, fallbackReason: reason
                });
                if (Array.isArray(fileContext) && fileContext.length) {
                    throw new Error('ATTACHMENTS_NOT_ALLOWED', { cause: error });
                }
                return fallbackToFree({ gemini, openrouter, providerLog, ErrorCategory, stageName,
                    geminiModel, selectedModel, requestedModelId, prompt, options, reason, hasGeminiKey });
            }
        };
    }

    return { makeCaller };
}

module.exports = { createSelectedModelRouter, fallbackReasonFor, resultWithRoute };
