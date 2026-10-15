const test = require('node:test');
const assert = require('node:assert/strict');
const { providerRequestContext } = require('../src/backend/providers/request-context');
const { createSpendGuard, utcKeys, pacificDay } = require('../src/backend/utils/spend-guard');
const { createOpenRouterProvider } = require('../src/backend/providers/openrouter');
const { createGeminiProvider } = require('../src/backend/providers/gemini');
const { OUTPUT_TOKENS, estimatePaidUsd } = require('../src/backend/config/provider-spend');
process.env.GEMINI_API_KEY = 'mock-only';
process.env.OPENROUTER_API_KEY = 'mock-only';

function fakeRedis() {
    const values = new Map();
    const overages = [];
    return {
        values,
        overages,
        async get(key) { return values.get(key) ?? null; },
        // eslint-disable-next-line complexity -- The fixture dispatches the guard's independent atomic Lua scripts.
        async eval(script, keys, args) {
            if (script.includes('local delta =')) {
                const held = values.get(keys[3]);
                if (!held) return JSON.stringify({ status: 'missing' });
                const [state, reserved] = held.split('|');
                if (state !== 'reserved') return JSON.stringify({ status: state, idempotent: true });
                const actual = Number(args[0]), delta = actual - Number(reserved);
                for (const key of [keys[0], keys[1], keys[5]]) values.set(key, Math.max(0, Number(values.get(key) || 0) + delta));
                if (actual > Number(reserved)) {
                    values.set(keys[2], '1');
                    overages.push({ requestId: args[1], provider: args[2], model: args[3],
                        reservedMicroUsd: Number(reserved), actualMicroUsd: actual,
                        overageMicroUsd: actual - Number(reserved), alert: 'critical', action: 'paid_requests_paused' });
                }
                values.set(keys[3], `settled|${actual}`);
                return JSON.stringify({ status: 'settled', reserved: Number(reserved), actual, overage: actual > Number(reserved) });
            }
            if (script.includes('local day =') && script.includes("'reserved|' .. amount")) {
                if (values.has(keys[2])) return -1;
                if (values.has(keys[3])) return 0;
                const day = Number(values.get(keys[0]) || 0), month = Number(values.get(keys[1]) || 0);
                const ipDay = Number(values.get(keys[5]) || 0), amount = Number(args[0]);
                if (day + amount > Number(args[1]) || month + amount > Number(args[2])) return -2;
                if (ipDay + amount > Number(args[4])) return -3;
                values.set(keys[0], day + amount); values.set(keys[1], month + amount); values.set(keys[5], ipDay + amount);
                values.set(keys[3], `reserved|${amount}`);
                return 1;
            }
            if (script.includes("redis.call('SET', KEYS[1], '1', 'EX'")) {
                values.set(keys[0], '1'); return 1;
            }
            if (script.includes('local used =')) {
                const used = Number(values.get(keys[0]) || 0);
                if (used >= Number(args[0])) return 0;
                values.set(keys[0], used + 1); return 1;
            }
            throw new Error('Unexpected spend-guard script');
        }
    };
}

const quietLog = { info() {}, warn() {}, error() {}, success() {} };
const providerDeps = (fetchWithAcceptTimeout, guard) => ({ fetchWithAcceptTimeout, providerLog: quietLog,
    providerAcceptTimeoutMs: 1000, reasoningForStage: () => null, guard });

test('global reservations count all provider spend, add margin and stay below USD caps', async () => {
    const redis = fakeRedis();
    const guard = createSpendGuard({ redis: () => redis, env: { PAID_SPEND_DAILY_USD: '0.05', PAID_SPEND_MONTHLY_USD: '1' } });
    const results = await Promise.all(Array.from({ length: 50 }, () => guard.reserve(0.007, { provider: 'gemini' })));
    assert.equal(results.filter(result => result.allowed).length, 5);
    assert.equal(redis.values.get(utcKeys(new Date())[0]), 43_750);
    assert.equal([...redis.values.values()].filter(value => value === 'reserved|8750').length, 5);
    assert.equal(redis.values.size, 8);
});

test('Redis unavailable fails closed and is reported separately from an exhausted USD cap', async () => {
    for (const redis of [() => null, () => { throw new Error('down'); }, () => ({ eval: async () => { throw new Error('down'); } })]) {
        const guard = createSpendGuard({ redis });
        assert.deepEqual(await guard.reserve(0.001), { allowed: false, reason: 'SPEND_GUARD_UNAVAILABLE' });
        assert.equal(await guard.reserveGeminiRequest(), false);
        const status = await guard.getSpendStatus();
        assert.equal(status.paidPaused, true);
        assert.equal(status.spendPaused, true);
    }
});

test('zero configured cap is an explicit kill switch and USD status includes both caps', async () => {
    const redis = fakeRedis();
    const guard = createSpendGuard({ redis: () => redis,
        env: { PAID_SPEND_DAILY_USD: '0', PAID_SPEND_MONTHLY_USD: '1', GEMINI_DAILY_APP_CAP: '0' } });
    assert.equal((await guard.reserve(0.0001)).reason, 'GLOBAL_SPEND_LIMIT');
    assert.equal(await guard.reserveGeminiRequest(), false);
    const status = await guard.getSpendStatus();
    assert.equal(status.paidPaused, true);
    assert.equal(status.spendPaused, true);
    assert.equal(status.dailyUsd, 0);
    assert.equal(status.monthlyUsd, 1);
});

test('UTC day/month reservations settle at actual provider cost and pause on unbudgeted overage', async () => {
    const redis = fakeRedis();
    let time = new Date('2026-10-31T23:59:00Z');
    const guard = createSpendGuard({ redis: () => redis, now: () => time,
        env: { PAID_SPEND_DAILY_USD: '0.01', PAID_SPEND_MONTHLY_USD: '0.015' } });
    const first = await guard.reserve(0.008, { provider: 'gemini' });
    assert.equal(first.amount, 10_000);
    assert.equal(await guard.settle(first, 0.003), true);
    const second = await guard.reserve(0.008, { provider: 'openrouter' });
    assert.equal(second.allowed, false);
    time = new Date('2026-11-01T00:01:00Z');
    const third = await guard.reserve(0.008, { provider: 'openrouter' });
    assert.equal(third.allowed, true);
    assert.equal(await guard.settle(third, 0.012), true);
    assert.equal(redis.values.get(utcKeys(time)[0]), 12_000);
    assert.equal(redis.values.get(utcKeys(time)[1]), 12_000);
    assert.equal(redis.values.get('{aedos-spend}:paused'), '1');
});

test('request-local cap aggregates providers and stops before exceeding the $0.24 reservation ceiling', async () => {
    const redis = fakeRedis();
    const guard = createSpendGuard({ redis: () => redis,
        env: { PAID_SPEND_DAILY_USD: '10', PAID_SPEND_MONTHLY_USD: '100', PAID_SPEND_PER_IP_DAILY_USD: '10',
            AI_SPEND_MAX_REQUEST_USD: '0.24' } });
    const state = { reservedMicroUsd: 0, settledMicroUsd: 0 };
    await providerRequestContext.run({ requestId: 'request-123', spendState: state }, async () => {
        const first = await guard.reserve(0.16, { provider: 'gemini' });
        assert.equal(first.allowed, true);
        assert.equal(first.amount, 200_000);
        assert.equal(await guard.settle(first, 0.16), true);
        assert.equal(state.settledMicroUsd, 160_000);
        const second = await guard.reserve(0.03, { provider: 'openrouter' });
        assert.equal(second.allowed, true);
        assert.equal(second.amount, 37_500);
        assert.equal((await guard.reserve(0.04, { provider: 'gemini' })).reason, 'REQUEST_SPEND_LIMIT');
    });
});

test('a real reported provider cost above reservation alerts once and blocks later provider calls', async (t) => {
    const redis = fakeRedis();
    const guard = createSpendGuard({ redis: () => redis, env: { OPENROUTER_API_KEY: 'test-only' } });
    const alerts = [];
    t.mock.method(process.stderr, 'write', chunk => { alerts.push(String(chunk)); return true; });
    let networkCalls = 0;
    const provider = createOpenRouterProvider(providerDeps(async () => {
        networkCalls += 1;
        assert.ok(Number(redis.values.get(utcKeys(new Date())[0])) > 0, 'Reserve in Redis BEFORE calling provider.');
        return new Response('data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\n'
            + 'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":1,"cost":0.02}}\n\ndata: [DONE]\n\n');
    }, guard));
    await providerRequestContext.run({ requestId: 'overage-correlated', clientIp: '192.0.2.20' }, async () => {
        const result = await provider.call('short prompt', 'Stage1', ['anthropic/claude-haiku-5.5'], null,
            { maxOutputTokens: 128 });
        for await (const chunk of result.stream) assert.ok(chunk, 'Consume successful content and the terminal usage frame.');
    });
    assert.equal(redis.overages.length, 1);
    assert.equal(redis.overages[0].requestId, 'overage-correlated');
    assert.equal(redis.overages[0].provider, 'openrouter');
    assert.equal(redis.overages[0].model, 'anthropic/claude-haiku-5.5');
    assert.equal(redis.overages[0].alert, 'critical');
    assert.ok(redis.overages[0].overageMicroUsd > 0);
    assert.equal(alerts.filter(line => line.includes('provider_spend_overage')).length, 1);
    assert.equal((await guard.getSpendStatus()).spendPaused, true);
    for (const clientIp of ['192.0.2.20', '192.0.2.21']) {
        await providerRequestContext.run({ requestId: `after-overage-${clientIp}`, clientIp }, async () => {
            await assert.rejects(provider.call('prompt', 'Stage1', ['anthropic/claude-haiku-5.5']), /PAID_PAUSED/);
        });
    }
    assert.equal(networkCalls, 1, 'No later request or fallback may call a provider while paused.');
});

test('an oversized attempt is rejected before Redis or provider even without an HTTP request context', async () => {
    let accesses = 0;
    const guard = createSpendGuard({ redis: () => { accesses += 1; return fakeRedis(); },
        env: { AI_SPEND_MAX_REQUEST_USD: '0.24', PAID_SPEND_PER_IP_DAILY_USD: '100' } });
    assert.equal((await guard.reserve(0.193)).reason, 'REQUEST_SPEND_LIMIT');
    assert.equal(accesses, 0);
});

test('a single bounded attempt stays below the $0.192 estimated-cost portion of the $0.24 reservation', () => {
    const requestLimit = 0.24 / 1.25;
    for (const model of ['google/gemini-3-flash-preview', 'anthropic/claude-haiku-5.5',
        'openai/gpt-6-luna', 'nvidia/nemotron-3.5-lightning']) {
        const estimate = estimatePaidUsd(model, 'x'.repeat(60_000), null, OUTPUT_TOKENS.Stage3);
        assert.ok(estimate < requestLimit, `${model} estimate ${estimate} exceeds $0.192`);
    }
});

test('bounded maximum-output Pro stages fit the reservation envelope; an unaffordable repair never starts', async () => {
    const redis = fakeRedis();
    const guard = createSpendGuard({ redis: () => redis, env: {} });
    const prompt = 'x'.repeat(60_000);
    let paidAttempts = 0;
    await providerRequestContext.run({ requestId: 'bounded-pro', clientIp: '192.0.2.40' }, async () => {
        for (const stage of ['Stage1', 'Stage2', 'Stage3']) {
            const estimate = estimatePaidUsd('google/gemini-3-flash-preview', prompt, null, OUTPUT_TOKENS[stage]);
            const reservation = await guard.reserve(estimate, { provider: 'openrouter', model: 'google/gemini-3-flash-preview' });
            assert.equal(reservation.allowed, true, stage);
            assert.ok(Number(redis.values.get(utcKeys(new Date())[0])) <= 240_000);
            paidAttempts += 1; // The simulated transport starts only AFTER its atomic reservation succeeds.
            await guard.settle(reservation, estimate);
        }
        assert.equal(Number(redis.values.get(utcKeys(new Date())[0])), 165_264);
        const repair = await guard.reserve(estimatePaidUsd('google/gemini-3-flash-preview', prompt, null, OUTPUT_TOKENS.Stage3));
        assert.equal(repair.reason, 'REQUEST_SPEND_LIMIT');
    });
    assert.equal(paidAttempts, 3);
});

test('OpenRouter price ceilings match the reservation tier including long-context prices', () => {
    const { providerPriceCeiling } = require('../src/backend/config/provider-spend');
    assert.deepEqual(providerPriceCeiling('google/gemini-3-flash-preview', 'short'), { prompt: 0.5, completion: 3 });
    assert.deepEqual(providerPriceCeiling('anthropic/claude-haiku-5.5', 'short'), { prompt: 0.1, completion: 0.5 });
    assert.deepEqual(providerPriceCeiling('anthropic/claude-haiku-5.5', 'x'.repeat(100_001)), { prompt: 0.5, completion: 2.5 });
});

test('daily reservations enforce an atomic per-IP USD cap while allowing another IP', async () => {
    const redis = fakeRedis();
    const guard = createSpendGuard({ redis: () => redis, env: {
        PAID_SPEND_DAILY_USD: '1', PAID_SPEND_MONTHLY_USD: '10', PAID_SPEND_PER_IP_DAILY_USD: '0.05',
        AI_SPEND_MAX_REQUEST_USD: '0.05'
    } });
    const reserveForIp = (ip) => providerRequestContext.run({ clientIp: ip,
        spendState: { reservedMicroUsd: 0, settledMicroUsd: 0, attemptCount: 0, startedAt: Date.now(), clientIp: ip } },
    () => guard.reserve(0.01, { provider: 'openrouter', requestId: `request-${ip}` }));
    const sameIp = await Promise.all(Array.from({ length: 10 }, () => reserveForIp('192.0.2.10')));
    assert.equal(sameIp.filter(result => result.allowed).length, 4);
    assert.ok(sameIp.some(result => result.reason === 'IP_SPEND_LIMIT'));
    assert.equal((await reserveForIp('192.0.2.11')).allowed, true);
});

test('request hard limits reject provider reservations after the attempt or time ceiling', async () => {
    const guard = createSpendGuard({ redis: () => fakeRedis(), env: {
        AI_SPEND_MAX_REQUEST_USD: '1', PAID_SPEND_PER_IP_DAILY_USD: '1'
    } });
    await providerRequestContext.run({ spendState: { reservedMicroUsd: 0, settledMicroUsd: 0,
        attemptCount: 27, startedAt: Date.now(), clientIp: '192.0.2.1' } }, async () => {
        assert.equal((await guard.reserve(0.001)).reason, 'REQUEST_ATTEMPT_LIMIT');
    });
    await providerRequestContext.run({ spendState: { reservedMicroUsd: 0, settledMicroUsd: 0,
        attemptCount: 0, startedAt: Date.now() - 10 * 60 * 1000, clientIp: '192.0.2.1' } }, async () => {
        assert.equal((await guard.reserve(0.001)).reason, 'REQUEST_TIMEOUT');
    });
});

test('safe production budget defaults cap a free service at $0.25/day and $1/month', () => {
    const { spendConfig } = require('../src/backend/config/provider-spend');
    const cfg = spendConfig({});
    assert.equal(cfg.dailyUsd, 0.25);
    assert.equal(cfg.monthlyUsd, 1);
    assert.ok(cfg.perIpDailyUsd <= cfg.dailyUsd);
    assert.ok(cfg.maxRequestReservationUsd <= cfg.dailyUsd);
    assert.equal(cfg.perIpDailyUsd, 0.24);
    assert.equal(cfg.maxRequestReservationUsd, 0.24);
    assert.equal(cfg.maxRequestDurationMs, 600000);
    assert.equal(cfg.maxProviderAttempts, 27);
    assert.equal(spendConfig({ AI_SPEND_RESERVATION_MARGIN: '0' }).reservationMargin, 1,
        'Configuration cannot reserve less than the bounded estimate.');
});

test('Gemini and OpenRouter emit normalized usage only after complete streams', async () => {
    let settled;
    const guard = { reserve: async () => ({ allowed: true, amount: 1_000_000 }),
        settle: async (_reservation, cost) => { settled = cost; }, reserveGeminiRequest: async () => true };
    const provider = createOpenRouterProvider(providerDeps(async () => new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":100,"cost":0.00015}}\n\ndata: [DONE]\n\n'), guard));
    const result = await provider.call('prompt', 'Stage1', ['anthropic/claude-haiku-5.5']);
    let output = '';
    let usage;
    for await (const chunk of result.stream) {
        if (typeof chunk === 'string') output += chunk;
        else if (chunk.type === 'usage') usage = chunk.usage;
    }
    assert.equal(output, 'ok');
    assert.equal(settled, 0.00015);
    assert.deepEqual(usage, { inputTokens: 1000, outputTokens: 100, reasoningTokens: 0, costUsd: 0.00015, reported: true });
});

test('provider stream failures still settle actual spend and are reported as failed attempts', async () => {
    let settled;
    const guard = { reserve: async () => ({ allowed: true, amount: 1_000_000 }),
        settle: async (_reservation, cost) => { settled = cost; } };
    const provider = createOpenRouterProvider(providerDeps(async () => new Response(
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n: keepalive\n\n'), guard));
    const result = await provider.call('prompt', 'Stage1', ['anthropic/claude-haiku-5.5']);
    let sawPartial = false;
    await assert.rejects(async () => {
        for await (const chunk of result.stream) if (typeof chunk === 'string') sawPartial ||= chunk === 'partial';
    }, /PROVIDER_INCOMPLETE_RESPONSE/);
    assert.equal(sawPartial, true);
    assert.ok(settled > 0);
});

test('Gemini attempt cap counts every attempt and stage output is bounded', async () => {
    const bodies = [];
    let slotCount = 0;
    const guard = { reserve: async () => ({ allowed: true, amount: 1_000_000 }), settle: async () => true,
        reserveGeminiRequest: async () => { slotCount += 1; return true; } };
    const gemini = createGeminiProvider(providerDeps(async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n');
    }, guard));
    for (const stage of Object.keys(OUTPUT_TOKENS)) {
        const result = await gemini.call('prompt', stage, 'gemini-3-flash-preview', null,
            { modelRoute: { requestedModelId: 'google/gemini-3-flash-preview' } });
        let output = '';
        for await (const chunk of result.stream) if (typeof chunk === 'string') output += chunk;
        assert.equal(output, 'ok');
        assert.equal(bodies.at(-1).generationConfig.maxOutputTokens, OUTPUT_TOKENS[stage]);
    }
    assert.equal(slotCount, Object.keys(OUTPUT_TOKENS).length);
    assert.equal(pacificDay(new Date('2026-10-11T06:59:00Z')), '2026-10-10');
    assert.notEqual(pacificDay(new Date('2026-10-11T06:59:00Z')), pacificDay(new Date('2026-10-11T07:01:00Z')));
});
