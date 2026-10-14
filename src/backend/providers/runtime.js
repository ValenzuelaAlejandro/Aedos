const { fetchWithAcceptTimeout } = require('./common');
const { createGeminiProvider } = require('./gemini');
const { createOpenRouterProvider } = require('./openrouter');
const { createProviderFallback, createTestProviderResponse } = require('./fallback');
const { createSelectedModelRouter } = require('./model-selection');

/**
 * Compose provider callers without performing a provider request.
 * @param {any} options
 * @returns {any} stage callers used by the pipeline handlers
 */
function createProviderRuntime({
    runtimeConfig,
    providerLog,
    classifyError,
    ErrorCategory,
    modelConfig,
    getTestProviderOverride
}) {
    const providerAcceptTimeoutMs = runtimeConfig.providerAcceptTimeoutMs;
    const geminiProvider = createGeminiProvider({
        fetchWithAcceptTimeout,
        providerLog,
        ErrorCategory,
        providerAcceptTimeoutMs
    });
    const openRouterProvider = createOpenRouterProvider({
        fetchWithAcceptTimeout,
        providerLog,
        classifyError,
        ErrorCategory,
        providerAcceptTimeoutMs,
        modelList: modelConfig.OPENROUTER_MODEL_LIST,
        stage3Only: modelConfig.OPENROUTER_MODELS_STAGE3_ONLY,
        reasoningForStage: modelConfig.reasoningForStage
    });
    const providerFallback = createProviderFallback({
        gemini: geminiProvider.call,
        openrouter: openRouterProvider.call,
        getOverride: getTestProviderOverride,
        createStub: createTestProviderResponse,
        providerLog,
        ErrorCategory
    });
    const selectedModelRouter = createSelectedModelRouter({
        gemini: geminiProvider.call,
        openrouter: openRouterProvider.call,
        makeBaseCaller: providerFallback.makeCaller,
        getOverride: getTestProviderOverride,
        createStub: createTestProviderResponse,
        providerLog,
        ErrorCategory
    });
    const tryModelsFlash = providerFallback.makeCaller('Flash', modelConfig.GEMINI_MODEL_FLASH, modelConfig.OPENROUTER_MODELS_FLASH);
    const tryModelsStage1 = providerFallback.makeCaller('Stage1', modelConfig.GEMINI_MODEL_STAGE1, modelConfig.OPENROUTER_MODELS_STAGE1);
    const tryModelsStage2 = providerFallback.makeCaller('Stage2', modelConfig.GEMINI_MODEL_STAGE2, modelConfig.OPENROUTER_MODELS_STAGE2);
    const tryModelsStage3 = providerFallback.makeCaller('Stage3', modelConfig.GEMINI_MODEL_STAGE3, modelConfig.OPENROUTER_MODELS_STAGE3);
    const trySelectedFlash = selectedModelRouter.makeCaller('Flash', modelConfig.GEMINI_MODEL_FLASH, modelConfig.OPENROUTER_MODELS_FLASH);
    const trySelectedStage1 = selectedModelRouter.makeCaller('Stage1', modelConfig.GEMINI_MODEL_STAGE1, modelConfig.OPENROUTER_MODELS_STAGE1);
    const trySelectedStage2 = selectedModelRouter.makeCaller('Stage2', modelConfig.GEMINI_MODEL_STAGE2, modelConfig.OPENROUTER_MODELS_STAGE2);
    const trySelectedStage3 = selectedModelRouter.makeCaller('Stage3', modelConfig.GEMINI_MODEL_STAGE3, modelConfig.OPENROUTER_MODELS_STAGE3);
    return {
        tryModelsFlash,
        tryModelsStage1,
        tryModelsStage2,
        tryModelsStage3,
        tryModelsStage1Thinking: (prompt, fileContext, options = {}) => tryModelsStage1(prompt, fileContext,
            { ...options, includeReasoning: true }),
        tryModelsStage2Thinking: (prompt, fileContext, options = {}) => tryModelsStage2(prompt, fileContext,
            { ...options, includeReasoning: true }),
        tryModelsStage3Thinking: (prompt, fileContext, options = {}) => tryModelsStage3(prompt, fileContext,
            { ...options, includeReasoning: true }),
        trySelectedFlash: (prompt, fileContext, options = {}) => trySelectedFlash(prompt, fileContext, options),
        trySelectedStage1Thinking: (prompt, fileContext, options = {}) => trySelectedStage1(prompt, fileContext,
            { includeReasoning: true, ...options }),
        trySelectedStage2Thinking: (prompt, fileContext, options = {}) => trySelectedStage2(prompt, fileContext,
            { includeReasoning: true, ...options }),
        trySelectedStage3Thinking: (prompt, fileContext, options = {}) => trySelectedStage3(prompt, fileContext,
            { includeReasoning: true, ...options })
    };
}

module.exports = { createProviderRuntime };
