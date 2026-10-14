const assert = require('node:assert/strict');
const test = require('node:test');
const { createCreditsLedger, resetAt, utcDay } = require('../src/backend/utils/credits-ledger');

class AtomicRedisMock {
    constructor() { this.values = new Map(); }
    async get(key) { return this.values.get(key) ?? null; }
    async eval(script, keys, args) {
        if (script.includes("'reserved|' .. cost")) return this.reserve(keys, args);
        if (script.includes("state == 'committed'")) return this.commit(keys);
        if (script.includes("redis.call('INCRBY'")) return this.refund(keys, args);
        if (script.includes("'committed|' .. cost")) return this.spend(keys, args);
        if (script.includes("count >= tonumber(ARGV[1])")) return this.schema(keys, args);
        throw new Error('Unknown Lua script');
    }
    reserve([balanceKey, requestKey], [daily, cost]) {
        const old = this.values.get(requestKey);
        const remaining = Number(this.values.get(balanceKey) ?? daily);
        if (old) return JSON.stringify({ status: 'duplicate', state: old.split('|')[0], cost: Number(old.split('|')[1]), remaining });
        if (Number(cost) > remaining) return JSON.stringify({ status: 'insufficient', remaining });
        this.values.set(balanceKey, remaining - Number(cost));
        this.values.set(requestKey, `reserved|${cost}`);
        return JSON.stringify({ status: 'reserved', remaining: remaining - Number(cost) });
    }
    spend([balanceKey, requestKey], [daily, cost]) {
        const old = this.values.get(requestKey);
        const remaining = Number(this.values.get(balanceKey) ?? daily);
        if (old) return JSON.stringify({ status: 'duplicate', remaining });
        if (Number(cost) > remaining) return JSON.stringify({ status: 'insufficient', remaining });
        this.values.set(balanceKey, remaining - Number(cost));
        this.values.set(requestKey, `committed|${cost}`);
        return JSON.stringify({ status: 'spent', remaining: remaining - Number(cost) });
    }
    commit([, requestKey]) {
        const value = this.values.get(requestKey);
        if (!value) return JSON.stringify({ status: 'missing' });
        const [state, cost] = value.split('|');
        if (state !== 'reserved') return JSON.stringify({ status: state });
        this.values.set(requestKey, `committed|${cost}`);
        return JSON.stringify({ status: 'committed' });
    }
    refund([balanceKey, requestKey], [daily]) {
        const value = this.values.get(requestKey);
        if (!value) return JSON.stringify({ status: 'missing' });
        const [state, cost] = value.split('|');
        if (state === 'refunded') return JSON.stringify({ status: 'refunded' });
        if (state !== 'reserved' && state !== 'committed') return JSON.stringify({ status: state });
        const remaining = Number(this.values.get(balanceKey) ?? daily) + Number(cost);
        this.values.set(balanceKey, remaining);
        this.values.set(requestKey, `refunded|${cost}`);
        return JSON.stringify({ status: 'refunded', remaining });
    }
    schema([key], [limit]) {
        const count = Number(this.values.get(key) || 0);
        if (count >= Number(limit)) return JSON.stringify({ status: 'limit', count });
        this.values.set(key, count + 1);
        return JSON.stringify({ status: 'allowed', count: count + 1 });
    }
}

test('50 concurrent reservations are atomic and do not overspend', async () => {
    const redis = new AtomicRedisMock();
    const ledger = createCreditsLedger({ redis: () => redis });
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => ledger.reserve('ip-a', 1, `request-${i}-key`)));

    assert.equal(results.filter(result => result.allowed).length, 50);
    assert.equal(await ledger.getRemaining('ip-a'), 0);
    const rejected = await ledger.reserve('ip-a', 1, 'request-over-limit');
    assert.deepEqual({ code: rejected.code, remaining: rejected.remaining }, { code: 'INSUFFICIENT_CREDITS', remaining: 0 });
});

test('commit, refund, and retries are idempotent', async () => {
    const redis = new AtomicRedisMock();
    const ledger = createCreditsLedger({ redis: () => redis });
    const reservation = await ledger.reserve('ip-b', 6, 'presentation-one');
    assert.equal(reservation.remaining, 44);
    assert.equal(await ledger.commit(reservation), true);
    assert.equal(await ledger.commit(reservation), true);
    assert.equal((await ledger.reserve('ip-b', 6, 'presentation-one')).code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await ledger.refund(reservation), true);
    assert.equal(await ledger.refund(reservation), true);
    assert.equal(await ledger.getRemaining('ip-b'), 50);
});

test('credit spend and schema quota use UTC dates and reset at midnight UTC', async () => {
    const redis = new AtomicRedisMock();
    const now = new Date('2026-10-13T23:59:00.000Z');
    const ledger = createCreditsLedger({ redis: () => redis, now: () => now });
    assert.equal(utcDay(now), '2026-10-13');
    assert.equal(resetAt(now).toISOString(), '2026-10-14T00:00:00.000Z');
    for (let i = 0; i < 10; i++) assert.equal((await ledger.reserveSchemaRequest('ip-c')).status, 'allowed');
    assert.equal((await ledger.reserveSchemaRequest('ip-c')).status, 'limit');
    assert.equal((await ledger.getRemaining('ip-c')).toString(), '50');
    assert.equal((await ledger.getRemaining('ip-c', new Date('2026-10-14T00:00:00.000Z'))), 50);
});

test('the same idempotency key cannot reserve credits again after midnight UTC', async () => {
    const redis = new AtomicRedisMock();
    const ledger = createCreditsLedger({ redis: () => redis });
    const first = await ledger.reserve('ip-cross-day', 10, 'stable-generation-id', new Date('2026-10-13T23:59:59.000Z'));
    assert.equal(first.remaining, 40);
    const retry = await ledger.reserve('ip-cross-day', 10, 'stable-generation-id', new Date('2026-10-14T00:00:01.000Z'));
    assert.equal(retry.allowed, false);
    assert.equal(retry.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await ledger.getRemaining('ip-cross-day', new Date('2026-10-14T00:00:01.000Z')), 50);
});

test('Redis failure blocks balance reads and reservations', async () => {
    const ledger = createCreditsLedger({ redis: () => null });
    await assert.rejects(ledger.getRemaining('ip-d'), { message: 'CREDITS_UNAVAILABLE' });
    await assert.rejects(ledger.reserve('ip-d', 1, 'request-down'), { message: 'CREDITS_UNAVAILABLE' });
    await assert.rejects(ledger.spend('ip-d', 1, 'spend-down'), { message: 'CREDITS_UNAVAILABLE' });
    await assert.rejects(ledger.reserveSchemaRequest('ip-d'), { message: 'CREDITS_UNAVAILABLE' });
});
