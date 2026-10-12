// Prices verified against https://openrouter.ai/api/v1/models on 2026-10-11.
// USD per token. The higher tier applies to Haiku prompts above 100k tokens.
const PAID_MODELS = Object.freeze({
    'anthropic/claude-haiku-5.5': Object.freeze({ input: 0.0000001, output: 0.0000005,
        longPromptThreshold: 100000, longInput: 0.0000005, longOutput: 0.0000025 }),
});
const FREE_MODELS = Object.freeze(['apodex/apodex-1.1-mini:free']);
// Typical 8-slide Pro HTML fixtures in examples/pro are 18-25k characters;
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
        dailyUsd: nonNegativeNumber(env.PAID_SPEND_DAILY_USD, 0.05),
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
    return inputTokens * (long ? price.longInput : price.input)
        + maxTokens * (long ? price.longOutput : price.output);
}

module.exports = { PAID_MODELS, FREE_MODELS, OUTPUT_TOKENS, spendConfig, estimatePaidUsd };
