const assert = require('node:assert/strict');
const test = require('node:test');
const { createRateLimitEvaluators } = require('../src/backend/utils/rate-limit-evaluators');

function makeEvaluators({ dailyTtlSec = 3600, globalDailyLimit = 10, finalizeMax = 2 } = {}) {
    const memoryState = {
        dailyCounters: new Map(),
        cooldowns: new Map(),
        finalizeCounters: new Map(),
    };
    return createRateLimitEvaluators({
        memoryState,
        dailyTtlSec,
        globalDailyLimit,
        finalizeWindowSec: 900,
        finalizeMax,
    });
}

test('memory generation evaluator no longer blocks on a per-mode daily limit', () => {
    const evaluators = makeEvaluators();
    const config = { daily: 1, cooldownSec: 0 };

    assert.deepEqual(evaluators.evaluateGenerateRateLimitMemory('127.0.0.1', 'outline', config), {
        allowed: true,
        source: 'memory',
        generationsToday: 1,
        globalGenerationsToday: 1,
    });
    const second = evaluators.evaluateGenerateRateLimitMemory('127.0.0.1', 'outline', config);
    assert.deepEqual(second, {
        allowed: true,
        source: 'memory',
        generationsToday: 2,
        globalGenerationsToday: 2,
    });
    const third = evaluators.evaluateGenerateRateLimitMemory('127.0.0.1', 'pro', config);
    assert.deepEqual(third, {
        allowed: true,
        source: 'memory',
        generationsToday: 3,
        globalGenerationsToday: 3,
    });
});

test('memory generation evaluator preserves the shared global limit', () => {
    const evaluators = makeEvaluators({ globalDailyLimit: 1 });

    assert.equal(evaluators.evaluateGenerateRateLimitMemory('a', 'flash', { daily: 5, cooldownSec: 0 }).allowed, true);
    const blocked = evaluators.evaluateGenerateRateLimitMemory('b', 'chat', { daily: 5, cooldownSec: 0 });

    assert.deepEqual({ ...blocked, retryAfterSec: undefined }, {
        allowed: false,
        source: 'memory',
        reason: 'global_daily_limit',
        statusCode: 429,
        errorCode: 'GLOBAL_DAILY_LIMIT_EXCEEDED',
        retryAfterSec: undefined,
        message: 'System daily generation limit reached. Please try again later.',
        limit: 1,
    });
    assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 3600);
});

test('memory finalize evaluator keeps the configured rolling-window limit', () => {
    const evaluators = makeEvaluators({ finalizeMax: 1 });

    assert.deepEqual(evaluators.evaluateFinalizeRateLimitMemory('127.0.0.1'), { allowed: true, source: 'memory' });
    const blocked = evaluators.evaluateFinalizeRateLimitMemory('127.0.0.1');
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 900);
});

test('Redis evaluator issues the same increment, expiry, and cooldown pipeline', async () => {
    const evaluators = makeEvaluators();
    const commands = [];
    const pipeline = {
        incr(key) { commands.push(['incr', key]); return this; },
        expire(key, seconds) { commands.push(['expire', key, seconds]); return this; },
        set(key, value, options) { commands.push(['set', key, value, options]); return this; },
        async exec() { commands.push(['exec']); return []; },
    };
    const client = {
        async exists() { return 0; },
        async get() { return null; },
        pipeline() { return pipeline; },
    };

    const decision = await evaluators.evaluateGenerateRateLimitRedis(client, '127.0.0.1', 'pro', {
        daily: 3,
        cooldownSec: 30,
    });

    assert.deepEqual(decision, { allowed: true, source: 'redis', generationsToday: 1, globalGenerationsToday: 1 });
    assert.deepEqual(commands, [
        ['incr', 'ratelimit:daily:global'],
        ['expire', 'ratelimit:daily:global', 3600],
        ['set', 'ratelimit:cooldown:pro:127.0.0.1', '1', { ex: 30 }],
        ['exec'],
    ]);
});
