const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpendGuard, utcKeys, pacificDay, PAID_PAUSE_SECONDS } = require('../src/backend/utils/spend-guard');
const { createProviderFallback } = require('../src/backend/providers/fallback');
const { createOpenRouterProvider } = require('../src/backend/providers/openrouter');
const { createGeminiProvider } = require('../src/backend/providers/gemini');
const { createModelConfig } = require('../src/backend/config/models');
const { OUTPUT_TOKENS, estimatePaidUsd } = require('../src/backend/config/provider-spend');
process.env.GEMINI_API_KEY = 'mock-only';
process.env.OPENROUTER_API_KEY = 'mock-only';

function fakeRedis() {
    const values = new Map();
    return {
        values,
        async get(key) { return values.get(key) ?? null; },
        async eval(script, keys, args) {
            if (script.includes("redis.call('SET', KEYS[1], '1', 'EX'")) {
                values.set(keys[0], '1');
                return 1;
            }
            if (script.includes('local day =')) {
                const day = Number(values.get(keys[0]) || 0);
                const month = Number(values.get(keys[1]) || 0);
                const amount = Number(args[0]);
                if (values.has(keys[2])) return 0;
                if (day + amount > Number(args[1]) || month + amount > Number(args[2])) return 0;
                values.set(keys[0], day + amount);
                values.set(keys[1], month + amount);
                return 1;
            }
            if (script.includes('local delta =')) {
                const delta = Number(args[0]) - Number(args[1]);
                for (const key of keys.slice(0, 2)) values.set(key, Math.max(0, Number(values.get(key) || 0) + delta));
                return 1;
            }
            if (script.includes('local used =')) {
                const used = Number(values.get(keys[0]) || 0);
                if (used >= Number(args[0])) return 0;
                values.set(keys[0], used + 1);
                return 1;
            }
            throw new Error('Unexpected script');
        },
    };
}

test('50 concurrent reservations cannot cross either USD cap', async () => {
    const redis = fakeRedis();
    const guard = createSpendGuard({ redis: () => redis, env: { PAID_SPEND_DAILY_USD: '0.05', PAID_SPEND_MONTHLY_USD: '1' } });
    const results = await Promise.all(Array.from({ length: 50 }, () => guard.reserve(0.007)));
    assert.equal(results.filter(result => result.allowed).length, 7);
    assert.deepEqual([...redis.values.values()], [49000, 49000]);
});

test('Redis unavailable fails closed for payment and Gemini without memory fallback', async () => {
    for (const redis of [() => null, () => { throw new Error('down'); }, () => ({ eval: async () => { throw new Error('down'); } })]) {
        const guard = createSpendGuard({ redis });
        assert.equal((await guard.reserve(0.001)).allowed, false);
        assert.equal(await guard.reserveGeminiRequest(), false);
        assert.deepEqual(await guard.getSpendStatus(), { paidPaused: true });
    }
});

test('zero configured cap is an explicit kill switch', async () => {
    const redis = fakeRedis();
    const guard = createSpendGuard({ redis: () => redis,
        env: { PAID_SPEND_DAILY_USD: '0', GEMINI_DAILY_APP_CAP: '0' } });
    assert.equal((await guard.reserve(0.0001)).allowed, false);
    assert.equal(await guard.reserveGeminiRequest(), false);
    assert.deepEqual(await guard.getSpendStatus(), { paidPaused: true });
});

test('daily/monthly UTC buckets, settle and release preserve actual spend', async () => {
    const redis = fakeRedis();
    let time = new Date('2026-10-31T23:59:00Z');
    const guard = createSpendGuard({ redis: () => redis, now: () => time,
        env: { PAID_SPEND_DAILY_USD: '0.01', PAID_SPEND_MONTHLY_USD: '0.015' } });
    const first = await guard.reserve(0.008);
    assert.equal(first.allowed, true);
    assert.equal(await guard.settle(first, 0.003), true);
    const second = await guard.reserve(0.008);
    assert.equal(second.allowed, false);
    time = new Date('2026-11-01T00:01:00Z');
    const third = await guard.reserve(0.008);
    assert.equal(third.allowed, true);
    assert.equal(await guard.release(third), true);
    assert.equal(redis.values.get(utcKeys(time)[0]), 0);
    assert.equal(redis.values.get(utcKeys(time)[1]), 0);
    assert.equal(redis.values.get(first.keys[1]), 3000);
});

test('settle adds over-reservation cost and releases under-reservation remainder', async () => {
    const redis = fakeRedis();
    const guard = createSpendGuard({ redis: () => redis,
        env: { PAID_SPEND_DAILY_USD: '0.05', PAID_SPEND_MONTHLY_USD: '1' } });
    const overReserved = await guard.reserve(0.004);
    assert.equal(await guard.settle(overReserved, 0.006), true);
    assert.deepEqual([...redis.values.values()], [6000, 6000]);

    const underReserved = await guard.reserve(0.01);
    assert.equal(await guard.settle(underReserved, 0.003), true);
    assert.deepEqual([...redis.values.values()], [9000, 9000]);
});

test('stage reservations cover the observed 8-slide Haiku calls and HTML exceeds two cents', () => {
    const observed = [
        { stage: 'Stage1', inputTokens: 3124, actualUsd: 0.00221 },
        { stage: 'Stage2', inputTokens: 22276, actualUsd: 0.0065 },
        { stage: 'Stage3', inputTokens: 28960, actualUsd: 0.0145 },
    ];
    const reservations = observed.map(({ stage, inputTokens, actualUsd }) => {
        const reserve = estimatePaidUsd('anthropic/claude-haiku-5.5', 'x'.repeat(inputTokens), null, OUTPUT_TOKENS[stage]);
        assert.ok(reserve >= actualUsd, `${stage} reserve ${reserve} should cover ${actualUsd}`);
        return reserve;
    });
    assert.ok(reservations[2] >= 0.02);
});

test('Gemini cap counts each attempt and switches date at Pacific midnight', async () => {
    const redis = fakeRedis();
    let time = new Date('2026-10-11T06:59:00Z');
    const guard = createSpendGuard({ redis: () => redis, now: () => time, env: { GEMINI_DAILY_APP_CAP: '2' } });
    assert.equal(await guard.reserveGeminiRequest(), true);
    assert.equal(await guard.reserveGeminiRequest(), true);
    assert.equal(await guard.reserveGeminiRequest(), false);
    time = new Date('2026-10-11T07:01:00Z');
    assert.notEqual(pacificDay(new Date('2026-10-11T06:59:00Z')), pacificDay(time));
    assert.equal(await guard.reserveGeminiRequest(), true);
});

test('optional management-key balance floor is cached and fails closed', async () => {
    const redis = fakeRedis();
    let fetches = 0;
    const guard = createSpendGuard({ redis: () => redis,
        env: { OPENROUTER_MANAGEMENT_KEY: 'mock-management-key', PAID_BALANCE_FLOOR_USD: '1' },
        fetchBalance: async () => {
            fetches++;
            return { ok: true, json: async () => ({ data: { total_credits: 2, total_usage: 0.9 } }) };
        },
    });
    assert.equal((await guard.reserve(0.001)).allowed, true);
    assert.equal((await guard.reserve(0.001)).allowed, true);
    assert.equal(fetches, 1);
    const lowBalance = createSpendGuard({ redis: () => redis,
        env: { OPENROUTER_MANAGEMENT_KEY: 'mock-management-key', PAID_BALANCE_FLOOR_USD: '1' },
        fetchBalance: async () => ({ ok: true, json: async () => ({ data: { total_credits: 2, total_usage: 0.97 } }) }),
    });
    assert.equal((await lowBalance.reserve(0.001)).allowed, false);
});

test('configured paid fallback is used only when there is no model selection', async () => {
    const calls = [];
    const fallback = createProviderFallback({
        gemini: async () => { calls.push('gemini'); throw new Error('GEMINI_APP_CAP_REACHED'); },
        openrouter: async (_prompt, _stage, models) => {
            calls.push(models[0]);
            if (models[0].endsWith(':free')) throw new Error('PROVIDER_UNAVAILABLE');
            throw new Error('PAID_PAUSED');
        },
        getOverride: () => null, createStub: () => null,
        providerLog: { warn() {} }, ErrorCategory: { PROVIDER: 'PROVIDER' },
    });
    await assert.rejects(fallback.makeCaller('Stage1', 'gemini-model', ['anthropic/claude-haiku-5.5'])('safe prompt'), /PAID_PAUSED/);
    assert.deepEqual(calls, ['gemini', 'anthropic/claude-haiku-5.5']);
});

test('a Gemini selection never reaches a paid fallback in a Pro stage', async () => {
    const calls = [];
    const fallback = createProviderFallback({
        gemini: async () => { throw new Error('GEMINI_APP_CAP_REACHED'); },
        openrouter: async (_prompt, _stage, models) => {
            calls.push(models[0]);
            throw new Error('PAID_PAUSED');
        },
        getOverride: () => null, createStub: () => null,
        providerLog: { warn() {} }, ErrorCategory: { PROVIDER: 'PROVIDER' },
    });
    await assert.rejects(fallback.makeCaller('Stage1', 'gemini-model', ['anthropic/claude-haiku-5.5'])(
        'safe prompt', null, { modelRoute: { requestedModelId: 'google/gemini-3-flash-preview' } }
    ), /PROVIDER_UNAVAILABLE/);
    assert.deepEqual(calls, []);
});

test('paid OpenRouter request never reaches network when reservation is denied', async () => {
    let requests = 0;
    const provider = createOpenRouterProvider({
        fetchWithAcceptTimeout: async () => { requests++; throw new Error('must not call'); },
        providerLog: { info() {}, warn() {}, success() {} }, classifyError: () => 'NETWORK',
        ErrorCategory: { CONFIG: 'CONFIG', PROVIDER: 'PROVIDER', NETWORK: 'NETWORK' },
        providerAcceptTimeoutMs: 1000, modelList: [], stage3Only: [], reasoningForStage: () => null,
        guard: { reserve: async () => ({ allowed: false }) },
    });
    await assert.rejects(provider.call('prompt', 'Stage3', ['anthropic/claude-haiku-5.5']), /PAID_PAUSED/);
    assert.equal(requests, 0);
});

test('402 and explicit credit-limit errors pause paid routes for subsequent requests', async () => {
    assert.equal(PAID_PAUSE_SECONDS, 600);
    for (const failure of [
        { status: 402, body: JSON.stringify({ error: { message: 'Payment required' } }) },
        { status: 403, body: JSON.stringify({ error: { code: 'insufficient_credits' } }) },
    ]) {
        const redis = fakeRedis();
        const guard = createSpendGuard({ redis: () => redis,
            env: { OPENROUTER_API_KEY: 'mock-only', PAID_SPEND_DAILY_USD: '0.05', PAID_SPEND_MONTHLY_USD: '1' } });
        let requests = 0;
        const provider = createOpenRouterProvider({
            fetchWithAcceptTimeout: async () => {
                requests++;
                return new Response(failure.body, { status: failure.status });
            },
            providerLog: { info() {}, warn() {}, success() {} }, classifyError: () => 'NETWORK',
            ErrorCategory: { CONFIG: 'CONFIG', PROVIDER: 'PROVIDER', NETWORK: 'NETWORK' },
            providerAcceptTimeoutMs: 1000, modelList: [], stage3Only: [], reasoningForStage: () => null, guard,
        });
        const duplicatePaidModels = ['anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-5.5'];
        await assert.rejects(provider.call('prompt', 'Stage3', duplicatePaidModels), /PAID_PAUSED/);
        assert.deepEqual(await guard.getSpendStatus(), { paidPaused: true });
        await assert.rejects(provider.call('prompt', 'Stage3', duplicatePaidModels), /PAID_PAUSED/);
        assert.equal(requests, 1);
    }
});

test('paid stream logs only cost metadata when actual cost exceeds its reservation', async () => {
    const warnings = [];
    let settled;
    const provider = createOpenRouterProvider({
        fetchWithAcceptTimeout: async () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":30000,"completion_tokens_details":{"reasoning_tokens":25000},"cost":0.05}}\n\ndata: [DONE]\n\n'),
        providerLog: { info() {}, warn: (...args) => warnings.push(args), success() {} }, classifyError: () => 'NETWORK',
        ErrorCategory: { CONFIG: 'CONFIG', PROVIDER: 'PROVIDER', NETWORK: 'NETWORK' },
        providerAcceptTimeoutMs: 1000, modelList: [], stage3Only: [], reasoningForStage: () => null,
        guard: { reserve: async () => ({ allowed: true }), settle: async (_reservation, cost) => { settled = cost; } },
    });
    const result = await provider.call('private prompt content', 'Stage3', ['anthropic/claude-haiku-5.5']);
    for await (const chunk of result.stream) assert.equal(typeof chunk, 'string');
    const overrun = warnings.find(([category, message]) => message === 'OpenRouter actual cost exceeded reservation');
    assert.ok(overrun);
    assert.equal(settled, 0.05);
    assert.equal(JSON.stringify(overrun).includes('private prompt content'), false);
});

test('per-stage reasoning settings resolve to model-supported efforts', () => {
    const defaults = createModelConfig({});
    assert.deepEqual(defaults.reasoningForStage('Stage3', 'openai/gpt-6-luna'), { effort: 'none' });
    assert.deepEqual(defaults.reasoningForStage('Stage3', 'anthropic/claude-haiku-5.5'), { enabled: false });
    assert.deepEqual(defaults.reasoningForStage('Stage2', 'anthropic/claude-haiku-5.5'), { effort: 'low' });
    assert.deepEqual(defaults.reasoningForStage('Stage2', 'nvidia/nemotron-3.5-lightning'), { enabled: false });

    const configured = createModelConfig({
        OPENROUTER_REASONING_EFFORT_HTML: 'high',
        OPENROUTER_REASONING_EFFORT_DESIGN: 'medium',
        OPENROUTER_REASONING_EFFORT_SCHEMA: 'max',
    });
    assert.deepEqual(configured.reasoningForStage('Stage3', 'openai/gpt-6-luna'), { effort: 'high' });
    assert.deepEqual(configured.reasoningForStage('Stage2', 'anthropic/claude-haiku-5.5'), { effort: 'medium' });
    assert.deepEqual(configured.reasoningForStage('Stage1', 'anthropic/claude-haiku-5.5'), { effort: 'max' });

});

test('stream usage settles actual cost and telemetry excludes prompt text', async () => {
    const logs = [];
    const originalWrite = process.stdout.write;
    let settled;
    process.stdout.write = function (chunk) { logs.push(String(chunk)); return true; };
    try {
        const provider = createOpenRouterProvider({
            fetchWithAcceptTimeout: async () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2,"completion_tokens_details":{"reasoning_tokens":1},"cost":0.0000022}}\n\ndata: [DONE]\n\n'),
            providerLog: { info() {}, warn() {}, success() {} }, classifyError: () => 'NETWORK',
            ErrorCategory: { CONFIG: 'CONFIG', PROVIDER: 'PROVIDER', NETWORK: 'NETWORK' },
            providerAcceptTimeoutMs: 1000, modelList: [], stage3Only: [], reasoningForStage: () => null,
            guard: { reserve: async () => ({ allowed: true }), settle: async (_r, cost) => { settled = cost; } },
        });
        const result = await provider.call('private prompt words', 'Stage1', ['anthropic/claude-haiku-5.5']);
        let output = '';
        for await (const chunk of result.stream) output += chunk;
        assert.equal(output, 'ok');
    } finally { process.stdout.write = originalWrite; }
    assert.equal(settled, 0.0000022);
    assert.equal(logs.some(line => line.includes('private prompt words')), false);
    assert.equal(JSON.parse(logs[0]).reasoning_tokens, 1);
});

test('paid stream without usage.cost settles from reported tokens and price table', async () => {
    let settled;
    const provider = createOpenRouterProvider({
        fetchWithAcceptTimeout: async () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":100}}\n\ndata: [DONE]\n\n'),
        providerLog: { info() {}, warn() {}, success() {} }, classifyError: () => 'NETWORK',
        ErrorCategory: { CONFIG: 'CONFIG', PROVIDER: 'PROVIDER', NETWORK: 'NETWORK' },
        providerAcceptTimeoutMs: 1000, modelList: [], stage3Only: [], reasoningForStage: () => null,
        guard: { reserve: async () => ({ allowed: true }), settle: async (_r, cost) => { settled = cost; } },
    });
    const result = await provider.call('prompt', 'Stage1', ['anthropic/claude-haiku-5.5']);
    for await (const chunk of result.stream) assert.equal(chunk, 'ok');
    assert.ok(Math.abs(settled - 0.00015) < 1e-12);
});

test('both providers send a stage-specific output cap', async () => {
    const bodies = [];
    const logger = { info() {}, warn() {}, success() {} };
    const gemini = createGeminiProvider({
        fetchWithAcceptTimeout: async (_url, options) => {
            bodies.push(JSON.parse(options.body));
            return new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n');
        }, providerLog: logger, ErrorCategory: { PROVIDER: 'PROVIDER' }, providerAcceptTimeoutMs: 1000,
        guard: { reserveGeminiRequest: async () => true },
    });
    for (const stage of Object.keys(OUTPUT_TOKENS)) {
        const result = await gemini.call('prompt', stage, 'mock-gemini');
        for await (const chunk of result.stream) assert.equal(chunk, 'ok');
        assert.equal(bodies.at(-1).generationConfig.maxOutputTokens, OUTPUT_TOKENS[stage]);
    }
    const router = createOpenRouterProvider({
        fetchWithAcceptTimeout: async (_url, options) => {
            bodies.push(JSON.parse(options.body));
            return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
        }, providerLog: logger, classifyError: () => 'NETWORK',
        ErrorCategory: { CONFIG: 'CONFIG', PROVIDER: 'PROVIDER', NETWORK: 'NETWORK' },
        providerAcceptTimeoutMs: 1000, modelList: [], stage3Only: [], reasoningForStage: () => null,
        guard: { reserve: async () => ({ allowed: true }), settle: async () => true },
    });
    const result = await router.call('prompt', 'Stage3', ['anthropic/claude-haiku-5.5']);
    for await (const chunk of result.stream) assert.equal(chunk, 'ok');
    assert.equal(bodies.at(-1).max_tokens, OUTPUT_TOKENS.Stage3);
    assert.deepEqual(bodies.at(-1).stream_options, { include_usage: true });
    assert.ok(estimatePaidUsd('anthropic/claude-haiku-5.5', 'x'.repeat(100001), null, 100)
        > estimatePaidUsd('anthropic/claude-haiku-5.5', 'x'.repeat(99000), null, 100));
});

test('Gemini 503 retry consumes a separate quota slot for each HTTP attempt', async () => {
    let slots = 0;
    let requests = 0;
    const provider = createGeminiProvider({
        fetchWithAcceptTimeout: async () => {
            requests++;
            return requests === 1 ? new Response('busy', { status: 503 })
                : new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n');
        }, providerLog: { info() {}, warn() {}, success() {} },
        ErrorCategory: { PROVIDER: 'PROVIDER', NETWORK: 'NETWORK' }, providerAcceptTimeoutMs: 1000,
        guard: { reserveGeminiRequest: async () => { slots++; return true; } },
    });
    const result = await provider.call('prompt', 'Stage1', 'mock-gemini');
    for await (const chunk of result.stream) assert.equal(chunk, 'ok');
    assert.equal(slots, 2);
    assert.equal(requests, 2);
});
