const { ENV_NAMES, DEFAULTS } = require('../contracts/config-defaults');

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

    const OPENROUTER_REASONING_FLASH = (env.OPENROUTER_REASONING_FLASH || 'low').trim().toLowerCase();
    const OPENROUTER_REASONING_STAGE1 = (env.OPENROUTER_REASONING_STAGE1 || 'medium').trim().toLowerCase();
    const OPENROUTER_REASONING_STAGE2 = (env.OPENROUTER_REASONING_STAGE2 || 'medium').trim().toLowerCase();
    const OPENROUTER_REASONING_STAGE3 = (env.OPENROUTER_REASONING_STAGE3 || 'medium').trim().toLowerCase();
    const VALID_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

    function reasoningForStage(stageName) {
        let effort;
        switch (stageName) {
            case 'Flash': effort = OPENROUTER_REASONING_FLASH; break;
            case 'Stage1': effort = OPENROUTER_REASONING_STAGE1; break;
            case 'Stage2': effort = OPENROUTER_REASONING_STAGE2; break;
            case 'Stage3': effort = OPENROUTER_REASONING_STAGE3; break;
            default: effort = 'low';
        }
        if (!VALID_REASONING_EFFORTS.has(effort)) effort = 'low';
        if (effort === 'none') return null;
        return { effort };
    }

    return {
        OPENROUTER_MODELS_FLASH,
        OPENROUTER_MODELS_STAGE1,
        OPENROUTER_MODELS_STAGE2,
        OPENROUTER_MODELS_STAGE3,
        OPENROUTER_MODEL_LIST,
        OPENROUTER_MODELS_STAGE3_ONLY,
        GEMINI_MODEL_FLASH: (env[ENV_NAMES.GEMINI_MODELS_FLASH] || DEFAULTS.GEMINI_MODELS_FLASH).trim(),
        GEMINI_MODEL_STAGE1: (env[ENV_NAMES.GEMINI_MODELS_STAGE1] || DEFAULTS.GEMINI_MODELS_STAGE1).trim(),
        GEMINI_MODEL_STAGE2: (env[ENV_NAMES.GEMINI_MODELS_STAGE2] || DEFAULTS.GEMINI_MODELS_STAGE2).trim(),
        GEMINI_MODEL_STAGE3: (env[ENV_NAMES.GEMINI_MODELS_STAGE3] || DEFAULTS.GEMINI_MODELS_STAGE3).trim(),
        reasoningForStage
    };
}

module.exports = { createModelConfig };
