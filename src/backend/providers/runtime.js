const { fetchWithAcceptTimeout } = require('./common');
const { createGeminiProvider } = require('./gemini');
const { createOpenRouterProvider } = require('./openrouter');
const { createProviderFallback, createTestProviderResponse } = require('./fallback');

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
    const tryModelsFlash = providerFallback.makeCaller('Flash', modelConfig.GEMINI_MODEL_FLASH, modelConfig.OPENROUTER_MODELS_FLASH);
    const tryModelsStage1 = providerFallback.makeCaller('Stage1', modelConfig.GEMINI_MODEL_STAGE1, modelConfig.OPENROUTER_MODELS_STAGE1);
    const tryModelsStage2 = providerFallback.makeCaller('Stage2', modelConfig.GEMINI_MODEL_STAGE2, modelConfig.OPENROUTER_MODELS_STAGE2);
    const tryModelsStage3 = providerFallback.makeCaller('Stage3', modelConfig.GEMINI_MODEL_STAGE3, modelConfig.OPENROUTER_MODELS_STAGE3);
    return {
        tryModelsFlash,
        tryModelsStage1,
        tryModelsStage2,
        tryModelsStage3,
        tryModelsFlashThinking: (prompt, fileContext) => tryModelsFlash(prompt, fileContext, { includeReasoning: true }),
        tryModelsStage1Thinking: (prompt, fileContext) => tryModelsStage1(prompt, fileContext, { includeReasoning: true }),
        tryModelsStage2Thinking: (prompt, fileContext) => tryModelsStage2(prompt, fileContext, { includeReasoning: true }),
        tryModelsStage3Thinking: (prompt, fileContext) => tryModelsStage3(prompt, fileContext, { includeReasoning: true })
    };
}

module.exports = { createProviderRuntime };
