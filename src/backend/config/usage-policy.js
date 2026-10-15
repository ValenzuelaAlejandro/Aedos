'use strict';

const { countTokens: gptTokenCount } = require('gpt-tokenizer');

// Existing 50-credit buckets are migrated into 50,000 milli-credit units.
// A credit was 2% of the old daily allowance; each unit is therefore 0.002%.
const LEGACY_CREDITS_PER_DAY = 50;
const UNITS_PER_CREDIT = 1000;
const DAILY_USAGE_UNITS = LEGACY_CREDITS_PER_DAY * UNITS_PER_CREDIT;
const MIN_START_USAGE_UNITS = 250; // 0.5% minimum reservation.
const MAX_CHAT_CONTEXT_TOKENS = 16_384;
const MAX_CHAT_INPUT_TOKENS = 12_288;
const MAX_CHAT_OUTPUT_TOKENS = 4_096;
const CHAT_OUTPUT_TOKEN_FACTOR = 5;
const CHAT_REFERENCE_USAGE_UNITS = 1000;
const CHAT_REFERENCE_INPUT_TOKENS = 2_000;
const CHAT_REFERENCE_OUTPUT_TOKENS = 500;
const CHAT_MODEL_WEIGHTS_MILLI = Object.freeze({
    'google/gemini-3-flash-preview': 1000,
    'anthropic/claude-haiku-5.5': 180,
    'openai/gpt-6-luna': 360,
    'nvidia/nemotron-3.5-lightning': 130,
});
const USAGE_PER_SLIDE_UNITS = Object.freeze({
    // Pro's full 15-slide range must fit the existing daily allowance.
    'google/gemini-3-flash-preview': Object.freeze({ flash: 1600, pro: 3200 }),
    'anthropic/claude-haiku-5.5': Object.freeze({ flash: 1200, pro: 2400 }),
    'openai/gpt-6-luna': Object.freeze({ flash: 1200, pro: 2400 }),
    'nvidia/nemotron-3.5-lightning': Object.freeze({ flash: 800, pro: 1600 }),
});
const MODEL_RATES_USD_PER_TOKEN = Object.freeze({
    'google/gemini-3-flash-preview': Object.freeze({ input: 0.0000005, output: 0.000003 }),
    'anthropic/claude-haiku-5.5': Object.freeze({ input: 0.0000001, output: 0.0000005 }),
    // OpenRouter's most expensive listed GPT-6 Luna route is $0.20/$1.00;
    // Nemotron providers list up to $0.10/$0.25. Chat usage weights use these ceilings.
    'openai/gpt-6-luna': Object.freeze({ input: 0.0000002, output: 0.000001 }),
    'nvidia/nemotron-3.5-lightning': Object.freeze({ input: 0.0000001, output: 0.00000025 }),
});

function countTokens(text) {
    return gptTokenCount(String(text || ''));
}

function chatUsageUnits(modelId, mode, inputTokens, outputTokens) {
    const weight = CHAT_MODEL_WEIGHTS_MILLI[modelId];
    if (!weight || !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)
        || inputTokens < 0 || outputTokens < 0) throw new Error('INVALID_CHAT_USAGE');
    const weightedTokens = Math.ceil(inputTokens + outputTokens * CHAT_OUTPUT_TOKEN_FACTOR);
    // One reference Flash answer (2,000 input + 500 output) is one old credit.
    const units = Math.ceil(weightedTokens * weight * CHAT_REFERENCE_USAGE_UNITS
        / ((CHAT_REFERENCE_INPUT_TOKENS + CHAT_REFERENCE_OUTPUT_TOKENS * CHAT_OUTPUT_TOKEN_FACTOR) * 1000));
    const flashUnits = Math.max(MIN_START_USAGE_UNITS, units);
    return mode === 'pro' ? flashUnits * 2 : flashUnits;
}

function reserveChatUsageUnits(modelId, mode, inputTokens, maxOutputTokens = MAX_CHAT_OUTPUT_TOKENS) {
    if (!Number.isSafeInteger(inputTokens) || inputTokens > MAX_CHAT_CONTEXT_TOKENS
        || inputTokens > MAX_CHAT_INPUT_TOKENS
        || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens > MAX_CHAT_OUTPUT_TOKENS) {
        throw new Error('CHAT_CONTEXT_LIMIT');
    }
    return chatUsageUnits(modelId, mode, inputTokens, maxOutputTokens);
}

function displayPercent(units, dailyUnits = DAILY_USAGE_UNITS) {
    const percentage = Math.max(0, Math.min(100, Number(units) / dailyUnits * 100));
    if (percentage > 0 && percentage < 1) return '<1%';
    return `${Math.floor(percentage)}%`;
}

function priceCostUsd(modelId, inputTokens, outputTokens) {
    const price = MODEL_RATES_USD_PER_TOKEN[modelId];
    if (!price) throw new Error('MODEL_UNPRICED');
    return inputTokens * price.input + outputTokens * price.output;
}

module.exports = {
    LEGACY_CREDITS_PER_DAY,
    UNITS_PER_CREDIT,
    DAILY_USAGE_UNITS,
    MIN_START_USAGE_UNITS,
    MAX_CHAT_CONTEXT_TOKENS,
    MAX_CHAT_INPUT_TOKENS,
    MAX_CHAT_OUTPUT_TOKENS,
    CHAT_OUTPUT_TOKEN_FACTOR,
    CHAT_REFERENCE_USAGE_UNITS,
    CHAT_REFERENCE_INPUT_TOKENS,
    CHAT_REFERENCE_OUTPUT_TOKENS,
    CHAT_MODEL_WEIGHTS_MILLI,
    USAGE_PER_SLIDE_UNITS,
    MODEL_RATES_USD_PER_TOKEN,
    countTokens,
    chatUsageUnits,
    reserveChatUsageUnits,
    displayPercent,
    priceCostUsd,
};
