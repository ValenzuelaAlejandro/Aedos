'use strict';

const { USAGE_PER_SLIDE_UNITS, reserveChatUsageUnits, MAX_CHAT_INPUT_TOKENS } = require('./usage-policy');

function chatReservationUnits(id) {
    return Object.freeze(Object.fromEntries(['flash', 'pro'].map(mode =>
        [mode, reserveChatUsageUnits(id, mode, MAX_CHAT_INPUT_TOKENS)])));
}

// Model IDs verified against OpenRouter's official Models API on 2026-10-12.
// Gemini's public selector ID maps to the direct Google model ID below.
// Never pass a request's modelId directly to a provider without resolving it here.
const MODEL_CATALOG = Object.freeze({
    'google/gemini-3-flash-preview': Object.freeze({
        id: 'google/gemini-3-flash-preview',
        chatReservationUnits: chatReservationUnits('google/gemini-3-flash-preview'),
        name: 'Gemini 3 Flash',
        provider: 'gemini',
        providerModelId: 'gemini-3-flash-preview',
        brand: 'gemini',
        tier: 'free',
        paid: false,
        billing: 'perSlide',
        usagePerSlideUnits: USAGE_PER_SLIDE_UNITS['google/gemini-3-flash-preview'],
        attachments: true,
        modes: Object.freeze(['flash', 'pro']),
        outputMaxTokens: 65536,
        maxSlides: Object.freeze({ flash: 8, pro: 15 }),
        compatibleStages: Object.freeze(['Flash', 'Stage3'])
    }),
    'nvidia/nemotron-3.5-lightning': Object.freeze({
        id: 'nvidia/nemotron-3.5-lightning',
        chatReservationUnits: chatReservationUnits('nvidia/nemotron-3.5-lightning'),
        name: 'Nemotron 3.5 Lightning',
        provider: 'openrouter',
        providerModelId: 'nvidia/nemotron-3.5-lightning',
        brand: 'nvidia',
        providerOnly: Object.freeze(['deepinfra']),
        tier: 'light',
        paid: true,
        billing: 'perSlide',
        usagePerSlideUnits: USAGE_PER_SLIDE_UNITS['nvidia/nemotron-3.5-lightning'],
        attachments: false,
        modes: Object.freeze(['flash', 'pro']),
        outputMaxTokens: 32768,
        maxSlides: Object.freeze({ flash: 8, pro: 15 }),
        compatibleStages: Object.freeze(['Flash', 'Stage3']),
        // Reserve against the upper end of OpenRouter's currently published provider prices.
        pricing: Object.freeze({ input: 0.0000001, output: 0.00000025 })
    }),
    'openai/gpt-6-luna': Object.freeze({
        id: 'openai/gpt-6-luna',
        chatReservationUnits: chatReservationUnits('openai/gpt-6-luna'),
        name: 'GPT-6 Luna',
        provider: 'openrouter',
        providerModelId: 'openai/gpt-6-luna',
        brand: 'openai',
        tier: 'standard',
        paid: true,
        billing: 'perSlide',
        usagePerSlideUnits: USAGE_PER_SLIDE_UNITS['openai/gpt-6-luna'],
        attachments: false,
        modes: Object.freeze(['flash', 'pro']),
        outputMaxTokens: 128000,
        maxSlides: Object.freeze({ flash: 8, pro: 15 }),
        compatibleStages: Object.freeze(['Flash', 'Stage3']),
        pricing: Object.freeze({
            // OpenRouter lists routes up to $0.20/M input and $1.00/M output.
            input: 0.0000002,
            output: 0.000001,
            longPromptThreshold: 272000,
            longInput: 0.0000002,
            longOutput: 0.000001
        })
    }),
    'anthropic/claude-haiku-5.5': Object.freeze({
        id: 'anthropic/claude-haiku-5.5',
        chatReservationUnits: chatReservationUnits('anthropic/claude-haiku-5.5'),
        name: 'Claude Haiku 5.5',
        provider: 'openrouter',
        providerModelId: 'anthropic/claude-haiku-5.5',
        brand: 'anthropic',
        tier: 'standard',
        paid: true,
        billing: 'perSlide',
        usagePerSlideUnits: USAGE_PER_SLIDE_UNITS['anthropic/claude-haiku-5.5'],
        attachments: false,
        modes: Object.freeze(['flash', 'pro']),
        outputMaxTokens: 128000,
        maxSlides: Object.freeze({ flash: 8, pro: 15 }),
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
