const { ENV_NAMES, DEFAULTS } = require('../contracts/config-defaults');

const VALID_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function readEffort(value, fallback) {
    const effort = String(value || fallback).trim().toLowerCase();
    const normalized = effort === 'off' || effort === 'disabled' ? 'none' : effort;
    return VALID_REASONING_EFFORTS.has(normalized) ? normalized : fallback;
}

// Controls reflect OpenRouter's model catalog and docs as checked 2026-10-11.
// Models without published effort lists receive no invented effort value.
function reasoningCapabilitiesForModel(modelId) {
    const model = String(modelId || '').trim().toLowerCase();
    if (model.startsWith('anthropic/claude-haiku-5.5')) {
        return { efforts: ['max', 'xhigh', 'high', 'medium', 'low'], canDisable: true };
    }
    if (model.startsWith('openai/gpt-6-luna')) {
        return { efforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'], canDisable: true };
    }
    if (model.startsWith('nvidia/nemotron-3.5-lightning')) {
        return { efforts: null, canDisable: true };
    }
    return null;
}

function createReasoningConfig(env) {
    const efforts = {
        Flash: readEffort(env.OPENROUTER_REASONING_FLASH, 'low'),
        Stage1: readEffort(env.OPENROUTER_REASONING_EFFORT_SCHEMA, 'low'),
        Stage2: readEffort(env.OPENROUTER_REASONING_EFFORT_DESIGN, 'low'),
        Stage3: readEffort(env.OPENROUTER_REASONING_EFFORT_HTML, 'none'),
    };

    function reasoningForStage(stageName, modelId) {
        const requestedEffort = efforts[stageName] || 'low';
        const capabilities = reasoningCapabilitiesForModel(modelId);
        if (!capabilities) return null;
        if (requestedEffort === 'none') {
            if (capabilities.efforts?.includes('none')) return { effort: 'none' };
            if (capabilities.canDisable) return { enabled: false };
        }
        if (!capabilities.efforts) {
            if (!capabilities.canDisable) return null;
            // With only a reasoning toggle, low/minimal maps to off; higher efforts
            // enable the provider's documented default of medium.
            return { enabled: !['minimal', 'low'].includes(requestedEffort) };
        }
        if (capabilities.efforts.includes(requestedEffort)) return { effort: requestedEffort };

        // Use the lowest documented effort when the model cannot accept the setting.
        const lowestEffort = capabilities.efforts[capabilities.efforts.length - 1];
        return lowestEffort ? { effort: lowestEffort } : null;
    }

    return { efforts, reasoningForStage };
}

/** Resolve provider model lists and per-stage reasoning at bootstrap time. */
function createModelConfig(env) {
    function parseModelList(rawValue, fallbackCsv) {
        return (rawValue || fallbackCsv)
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }

    const OPENROUTER_MODELS_FLASH = parseModelList(env[ENV_NAMES.OPENROUTER_MODELS_FLASH], DEFAULTS.OPENROUTER_MODELS_FLASH);
    const OPENROUTER_MODELS_STAGE1 = parseModelList(env[ENV_NAMES.OPENROUTER_MODELS_STAGE1], DEFAULTS.OPENROUTER_MODELS_STAGE1);
    const OPENROUTER_MODELS_STAGE2 = parseModelList(env[ENV_NAMES.OPENROUTER_MODELS_STAGE2], DEFAULTS.OPENROUTER_MODELS_STAGE2);
    const OPENROUTER_MODELS_STAGE3 = parseModelList(env[ENV_NAMES.OPENROUTER_MODELS_STAGE3], DEFAULTS.OPENROUTER_MODELS_STAGE3);
    const OPENROUTER_MODEL_LIST = OPENROUTER_MODELS_FLASH;
    const OPENROUTER_MODELS_STAGE3_ONLY = parseModelList(
        env[ENV_NAMES.OPENROUTER_MODELS_STAGE3_ONLY],
        DEFAULTS.OPENROUTER_MODELS_STAGE3_ONLY
    ).map(model => String(model).trim().toLowerCase());

    const reasoningConfig = createReasoningConfig(env);

    return {
        OPENROUTER_MODELS_FLASH,
        OPENROUTER_MODELS_STAGE1,
        OPENROUTER_MODELS_STAGE2,
        OPENROUTER_MODELS_STAGE3,
        OPENROUTER_MODEL_LIST,
        OPENROUTER_MODELS_STAGE3_ONLY,
        OPENROUTER_REASONING_EFFORT_SCHEMA: reasoningConfig.efforts.Stage1,
        OPENROUTER_REASONING_EFFORT_DESIGN: reasoningConfig.efforts.Stage2,
        OPENROUTER_REASONING_EFFORT_HTML: reasoningConfig.efforts.Stage3,
        GEMINI_MODEL_FLASH: (env[ENV_NAMES.GEMINI_MODELS_FLASH] || DEFAULTS.GEMINI_MODELS_FLASH).trim(),
        GEMINI_MODEL_STAGE1: (env[ENV_NAMES.GEMINI_MODELS_STAGE1] || DEFAULTS.GEMINI_MODELS_STAGE1).trim(),
        GEMINI_MODEL_STAGE2: (env[ENV_NAMES.GEMINI_MODELS_STAGE2] || DEFAULTS.GEMINI_MODELS_STAGE2).trim(),
        GEMINI_MODEL_STAGE3: (env[ENV_NAMES.GEMINI_MODELS_STAGE3] || DEFAULTS.GEMINI_MODELS_STAGE3).trim(),
        reasoningForStage: reasoningConfig.reasoningForStage
    };
}

module.exports = { createModelConfig };
