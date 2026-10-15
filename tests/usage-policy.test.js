const assert = require('node:assert/strict');
const test = require('node:test');
const { DAILY_USAGE_UNITS, UNITS_PER_CREDIT, MIN_START_USAGE_UNITS, countTokens,
    chatUsageUnits, reserveChatUsageUnits, displayPercent } = require('../src/backend/config/usage-policy');

test('daily usage preserves the 50-credit allowance as milli-credit units', () => {
    assert.equal(DAILY_USAGE_UNITS, 50_000);
    assert.equal(UNITS_PER_CREDIT, 1000);
    assert.equal(MIN_START_USAGE_UNITS, 250);
});

test('chat usage is tokenized and provider-weighted; Pro exactly doubles even the minimum charge', () => {
    const input = countTokens('A practical guide to renewable energy');
    assert.ok(input > 0);
    const flash = chatUsageUnits('google/gemini-3-flash-preview', 'flash', input, 100);
    const pro = chatUsageUnits('google/gemini-3-flash-preview', 'pro', input, 100);
    assert.equal(pro, flash * 2);
    assert.equal(chatUsageUnits('nvidia/nemotron-3.5-lightning', 'flash', 20_000, 5_000), 1_300);
    assert.equal(chatUsageUnits('nvidia/nemotron-3.5-lightning', 'flash', 1, 1), MIN_START_USAGE_UNITS);
    assert.equal(chatUsageUnits('nvidia/nemotron-3.5-lightning', 'pro', 1, 1), MIN_START_USAGE_UNITS * 2);
    assert.equal(reserveChatUsageUnits('google/gemini-3-flash-preview', 'pro', 12_288, 4096), 14_564);
    assert.throws(() => reserveChatUsageUnits('google/gemini-3-flash-preview', 'flash', 12_289, 4096), /CHAT_CONTEXT_LIMIT/);
});

test('daily use is displayed in whole percent with sub-one-percent usage kept internally', () => {
    assert.equal(displayPercent(250), '<1%');
    assert.equal(displayPercent(10_000), '20%');
    assert.equal(displayPercent(50_000), '100%');
});
