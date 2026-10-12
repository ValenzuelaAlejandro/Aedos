'use strict';

// Model IDs verified against OpenRouter's official Models API on 2026-10-12.
// Gemini's public selector ID maps to the direct Google model ID below.
// Never pass a request's modelId directly to a provider without resolving it here.
const MODEL_CATALOG = Object.freeze({
    'google/gemini-3-flash-preview': Object.freeze({
        id: 'google/gemini-3-flash-preview',
        provider: 'gemini',
        providerModelId: 'gemini-3-flash-preview',
        tier: 'free',
        paid: false,
        attachments: true,
        outputMaxTokens: 65536,
        maxSlides: Object.freeze({ flash: 15, pro: 8 }),
        compatibleStages: Object.freeze(['Flash', 'Stage3'])
    }),
    'apodex/apodex-1.1-mini:free': Object.freeze({
        id: 'apodex/apodex-1.1-mini:free',
        provider: 'openrouter',
        providerModelId: 'apodex/apodex-1.1-mini:free',
        tier: 'free',
        paid: false,
        attachments: false,
        outputMaxTokens: 235929,
        maxSlides: Object.freeze({ flash: 15, pro: 8 }),
        compatibleStages: Object.freeze(['Flash', 'Stage3'])
    }),
    'nvidia/nemotron-3.5-lightning': Object.freeze({
        id: 'nvidia/nemotron-3.5-lightning',
        provider: 'openrouter',
        providerModelId: 'nvidia/nemotron-3.5-lightning',
        providerOnly: Object.freeze(['deepinfra']),
        tier: 'light',
        paid: true,
        attachments: false,
        outputMaxTokens: 32768,
        maxSlides: Object.freeze({ flash: 8, pro: 8 }),
        compatibleStages: Object.freeze(['Flash', 'Stage3']),
        pricing: Object.freeze({ input: 0.00000006, output: 0.00000016 })
    }),
    'openai/gpt-6-luna': Object.freeze({
        id: 'openai/gpt-6-luna',
        provider: 'openrouter',
        providerModelId: 'openai/gpt-6-luna',
        tier: 'standard',
        paid: true,
        attachments: false,
        outputMaxTokens: 128000,
        maxSlides: Object.freeze({ flash: 15, pro: 8 }),
        compatibleStages: Object.freeze(['Flash', 'Stage3']),
        pricing: Object.freeze({
            input: 0.0000001,
            output: 0.0000005,
            longPromptThreshold: 272000,
            longInput: 0.0000002,
            longOutput: 0.00000075
        })
    }),
    'anthropic/claude-haiku-5.5': Object.freeze({
        id: 'anthropic/claude-haiku-5.5',
        provider: 'openrouter',
        providerModelId: 'anthropic/claude-haiku-5.5',
        tier: 'standard',
        paid: true,
        attachments: false,
        outputMaxTokens: 128000,
        maxSlides: Object.freeze({ flash: 15, pro: 8 }),
        compatibleStages: Object.freeze(['Flash', 'Stage3']),
        pricing: Object.freeze({
            input: 0.0000001,
            output: 0.0000005,
            longPromptThreshold: 100000,
            longInput: 0.0000005,
            longOutput: 0.0000025
        })
    })
});

const DEFAULT_MODEL_ID = 'google/gemini-3-flash-preview';

function resolveModelId(value, catalog = MODEL_CATALOG) {
    const isAbsent = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    const requestedModelId = typeof value === 'string' ? value.trim() : null;
    const id = isAbsent ? DEFAULT_MODEL_ID : requestedModelId;
    const model = catalog[id];
    if (!Object.prototype.hasOwnProperty.call(catalog, id) || !model || model.enabled === false) {
        return {
            valid: false,
            requestedModelId: requestedModelId || null,
            code: 'MODEL_NOT_ALLOWED',
            message: 'Choose a model available in the Aedos model selector.'
        };
    }
    return { valid: true, requestedModelId: id, model };
}

function validateModelForGeneration(model, mode, slides) {
    const selectedMode = mode === 'pro' ? 'pro' : 'flash';
    if (!model.compatibleStages.includes(selectedMode === 'pro' ? 'Stage3' : 'Flash')) {
        return { valid: false, code: 'MODEL_STAGE_NOT_SUPPORTED', message: 'Choose a model supported for this generation mode.' };
    }
    const maxSlides = model.maxSlides[selectedMode];
    if (slides > maxSlides) {
        return {
            valid: false,
            code: 'MODEL_SLIDE_LIMIT',
            message: `This model supports up to ${maxSlides} slides in ${selectedMode} mode. Reduce the slide count and try again.`,
            maxSlides
        };
    }
    return { valid: true, maxSlides };
}

function validateAttachments(model, hasAttachments, geminiAvailable) {
    if (!hasAttachments) return { valid: true };
    if (model.provider !== 'gemini' || !model.attachments || !geminiAvailable) {
        return {
            valid: false,
            code: 'ATTACHMENTS_NOT_ALLOWED',
            message: 'Attachments require Gemini and an available Gemini request today.'
        };
    }
    return { valid: true };
}

module.exports = {
    MODEL_CATALOG,
    DEFAULT_MODEL_ID,
    resolveModelId,
    validateModelForGeneration,
    validateAttachments
};
