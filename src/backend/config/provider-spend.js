// OpenRouter model and endpoint prices verified on 2026-10-12.
// Values are USD per token and sourced from the server-owned model catalog.
const { MODEL_CATALOG } = require('./model-catalog');
const PAID_MODELS = Object.freeze(Object.fromEntries(Object.values(MODEL_CATALOG)
    .filter(model => {
        const config = /** @type {any} */ (model);
        return config.provider === 'openrouter' && config.paid && config.pricing;
    })
    .map(model => {
        const config = /** @type {any} */ (model);
        return [config.providerModelId, Object.freeze({
            ...config.pricing,
            maxOutputTokens: config.outputMaxTokens,
            providerOnly: config.providerOnly || null
        })];
    })));
const FREE_MODELS = Object.freeze(Object.values(MODEL_CATALOG)
    .filter(model => model.provider === 'openrouter' && !model.paid)
    .map(model => model.providerModelId));
const MODEL_OUTPUT_TOKENS = Object.freeze(Object.fromEntries(Object.values(MODEL_CATALOG)
    .filter(model => model.provider === 'openrouter')
    .map(model => [model.providerModelId, model.outputMaxTokens])));
// Typical 8-slide Pro HTML outputs are 18-25k characters;
// these ceilings leave several times that output budget, including reasoning.
// The 1.2 MB Java fixture is an exceptional embedded-asset outlier.
const OUTPUT_TOKENS = Object.freeze({ Flash: 32768, Stage1: 8192, Stage2: 16384, Stage3: 65536 });

function nonNegativeNumber(value, fallback) {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function spendConfig(env = process.env) {
    return {
        dailyUsd: nonNegativeNumber(env.PAID_SPEND_DAILY_USD, 0.25),
        monthlyUsd: nonNegativeNumber(env.PAID_SPEND_MONTHLY_USD, 1),
        balanceFloorUsd: nonNegativeNumber(env.PAID_BALANCE_FLOOR_USD, 1),
        geminiDailyCap: Math.floor(nonNegativeNumber(env.GEMINI_DAILY_APP_CAP, 16)),
    };
}

function estimatePaidUsd(model, prompt, fileContext, maxTokens) {
    const price = PAID_MODELS[model];
    if (!price || (Array.isArray(fileContext) && fileContext.length)) return null;
    // One token cannot contain fewer than one UTF-8 byte; this is deliberately
    // an upper bound for text prompts, plus a small request-envelope allowance.
    const inputTokens = Buffer.byteLength(typeof prompt === 'string' ? prompt : JSON.stringify(prompt), 'utf8') + 1024;
    const long = inputTokens > price.longPromptThreshold;
    return inputTokens * (long ? price.longInput || price.input : price.input)
        + Math.min(maxTokens, price.maxOutputTokens || maxTokens) * (long ? price.longOutput || price.output : price.output);
}

module.exports = { PAID_MODELS, FREE_MODELS, MODEL_OUTPUT_TOKENS, OUTPUT_TOKENS, spendConfig, estimatePaidUsd };
