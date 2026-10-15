// Rates use current OpenRouter list prices; see docs/DECISIONS-BLOQUE-2.md.
const { MODEL_CATALOG } = require('./model-catalog');
const PAID_MODELS = Object.freeze({
    'google/gemini-3-flash-preview': Object.freeze({ input: 0.0000005, output: 0.000003, maxOutputTokens: 65536 }),
    ...Object.fromEntries(
        Object.values(MODEL_CATALOG)
            .filter((model) => {
                const config = /** @type {any} */ (model);
                return config.provider === 'openrouter' && config.paid && config.pricing;
            })
            .map((model) => {
                const config = /** @type {any} */ (model);
                return [
                    config.providerModelId,
                    Object.freeze({
                        ...config.pricing,
                        maxOutputTokens: config.outputMaxTokens,
                        providerOnly: config.providerOnly || null,
                    }),
                ];
            }),
    ),
});
const FREE_MODELS = Object.freeze(Object.values(MODEL_CATALOG)
    .filter(model => model.provider === 'openrouter' && !model.paid)
    .map(model => model.providerModelId));
const MODEL_OUTPUT_TOKENS = Object.freeze(Object.fromEntries(Object.values(MODEL_CATALOG)
    .filter(model => model.provider === 'openrouter')
    .map(model => [model.providerModelId, model.outputMaxTokens])));
// Application limits cap every model and provider attempt. A request-level USD
// reservation budget below provides the final bound across retries and repairs.
const OUTPUT_TOKENS = Object.freeze({ Flash: 8192, Stage1: 4096, Stage2: 4096, Stage3: 16384 });
const MAX_PROVIDER_ATTEMPTS_PER_REQUEST = 27;
const MAX_REQUEST_DURATION_MS = 10 * 60 * 1000;
const MAX_STAGE_STREAM_DURATION_MS = 3 * 60 * 1000;

function nonNegativeNumber(value, fallback) {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function spendConfig(env = process.env) {
    const requestDuration = nonNegativeNumber(env.AI_SPEND_MAX_REQUEST_DURATION_MS, MAX_REQUEST_DURATION_MS);
    return {
        dailyUsd: nonNegativeNumber(env.PAID_SPEND_DAILY_USD, 0.25),
        monthlyUsd: nonNegativeNumber(env.PAID_SPEND_MONTHLY_USD, 1),
        perIpDailyUsd: nonNegativeNumber(env.PAID_SPEND_PER_IP_DAILY_USD, 0.24),
        balanceFloorUsd: nonNegativeNumber(env.PAID_BALANCE_FLOOR_USD, 1),
        geminiDailyCap: Math.floor(nonNegativeNumber(env.GEMINI_DAILY_APP_CAP, 16)),
        maxRequestReservationUsd: nonNegativeNumber(env.AI_SPEND_MAX_REQUEST_USD, 0.24),
        reservationMargin: Math.max(1, nonNegativeNumber(env.AI_SPEND_RESERVATION_MARGIN, 1.25)),
        maxProviderAttempts: MAX_PROVIDER_ATTEMPTS_PER_REQUEST,
        maxRequestDurationMs: Math.min(MAX_REQUEST_DURATION_MS, Math.max(1, requestDuration)),
    };
}

function estimatedInputTokens(prompt, fileContext) {
    // One token cannot contain fewer than one UTF-8 byte; this is deliberately
    // an upper bound for text prompts, plus a small request-envelope allowance.
    return Buffer.byteLength(typeof prompt === 'string' ? prompt : JSON.stringify(prompt), 'utf8')
        + (fileContext?.length ? Buffer.byteLength(JSON.stringify(fileContext), 'utf8') : 0) + 1024;
}

function estimatePaidUsd(model, prompt, fileContext, maxTokens) {
    const price = PAID_MODELS[model];
    if (!price) return null;
    const inputTokens = estimatedInputTokens(prompt, fileContext);
    const long = inputTokens > price.longPromptThreshold;
    return inputTokens * (long ? price.longInput || price.input : price.input)
        + Math.min(maxTokens, price.maxOutputTokens || maxTokens) * (long ? price.longOutput || price.output : price.output);
}

function providerPriceCeiling(model, prompt, fileContext) {
    const price = PAID_MODELS[model];
    if (!price) throw new Error('PROVIDER_UNPRICED_INPUT');
    const long = estimatedInputTokens(prompt, fileContext) > price.longPromptThreshold;
    // Pin provider routing to the same price tier used by the reservation estimate.
    // max_price is in USD per million tokens, unlike our per-token config.
    const perMillion = rate => Number((rate * 1_000_000).toPrecision(12));
    return { prompt: perMillion(long ? price.longInput || price.input : price.input),
        completion: perMillion(long ? price.longOutput || price.output : price.output) };
}

module.exports = {
    PAID_MODELS,
    FREE_MODELS,
    MODEL_OUTPUT_TOKENS,
    OUTPUT_TOKENS,
    MAX_PROVIDER_ATTEMPTS_PER_REQUEST, MAX_REQUEST_DURATION_MS, MAX_STAGE_STREAM_DURATION_MS,
    spendConfig,
    estimatePaidUsd,
    providerPriceCeiling,
};
