const assert = require('node:assert/strict');
const test = require('node:test');
const { createCreditsLedger, createMemoryCreditsLedger, resetAt, utcDay } = require('../src/backend/utils/credits-ledger');
const { DAILY_USAGE_UNITS, UNITS_PER_CREDIT } = require('../src/backend/config/usage-policy');

class AtomicRedisMock {
    constructor() { this.values = new Map(); }
    async get(key) { return this.values.get(key) ?? null; }
    async eval(script, keys, args) {
        if (script.includes('local remaining = redis.call') && keys.length === 2) return this.migrate(keys, args);
        if (script.includes('redis.call(\'DECRBY\'')) return this.reserve(keys, args);
        if (script.includes("redis.call('INCR', KEYS[1])")) return this.settleSchema(keys);
        if (script.includes("state ~= 'reserved' then return 0")) return this.refundSchema(keys);
        if (script.includes("state == 'committed'")) return this.commit(keys, args);
        if (script.includes("state == 'refunded'")) return this.refund(keys, args);
        if (script.includes("redis.call('INCRBY'")) return this.refund(keys, args);
        if (script.includes("'committed|' .. cost")) return this.spend(keys, args);
        if (script.includes('used + pending >=')) return this.schema(keys, args);
        throw new Error('Unknown Lua script');
    }
    migrate([balanceKey, legacyBalanceKey], [daily, , ttl, scale]) {
        if (!this.values.has(balanceKey)) {
            const legacy = this.values.get(legacyBalanceKey);
            const remaining = legacy === undefined ? Number(daily) : Number(legacy) * Number(scale);
            this.values.set(balanceKey, remaining);
            if (legacy === undefined) this.values.set(legacyBalanceKey, Math.floor(remaining / Number(scale)));
        }
        return this.values.get(balanceKey);
    }
    reserve([balanceKey, legacyBalanceKey, requestKey, legacyRequestKey], [daily, cost, , scale]) {
        this.migrate([balanceKey, legacyBalanceKey], [daily, 0, 3600, scale]);
        const old = this.values.get(requestKey) || this.values.get(legacyRequestKey);
        const remaining = Number(this.values.get(balanceKey));
        if (old) return JSON.stringify({ status: 'duplicate', remaining });
        if (Number(cost) > remaining) return JSON.stringify({ status: 'insufficient', remaining });
        this.values.set(balanceKey, remaining - Number(cost));
        this.values.set(legacyBalanceKey, Math.floor((remaining - Number(cost)) / Number(scale)));
        this.values.set(requestKey, `reserved|${cost}`);
        this.values.set(legacyRequestKey, `reserved|${Math.floor(Number(cost) / Number(scale))}`);
        return JSON.stringify({ status: 'reserved', remaining: remaining - Number(cost) });
    }
    spend([balanceKey, legacyBalanceKey, requestKey, legacyRequestKey], [daily, cost, , scale]) {
        this.migrate([balanceKey, legacyBalanceKey], [daily, 0, 3600, scale]);
        const old = this.values.get(requestKey) || this.values.get(legacyRequestKey);
        const remaining = Number(this.values.get(balanceKey));
        if (old) return JSON.stringify({ status: 'duplicate', remaining });
        if (Number(cost) > remaining) return JSON.stringify({ status: 'insufficient', remaining });
        this.values.set(balanceKey, remaining - Number(cost));
        this.values.set(legacyBalanceKey, Math.floor((remaining - Number(cost)) / Number(scale)));
        this.values.set(requestKey, `committed|${cost}`);
        this.values.set(legacyRequestKey, `committed|${Math.floor(Number(cost) / Number(scale))}`);
        return JSON.stringify({ status: 'spent', remaining: remaining - Number(cost) });
    }
    commit([balanceKey, requestKey, legacyBalanceKey, legacyRequestKey], [actualCost, scale]) {
        const value = this.values.get(requestKey);
        if (!value) return JSON.stringify({ status: 'missing' });
        const [state, cost] = value.split('|');
        if (state !== 'reserved') return JSON.stringify({ status: state });
        const actual = Number(actualCost ?? cost);
        if (actual < Number(cost)) this.values.set(balanceKey, Number(this.values.get(balanceKey)) + Number(cost) - actual);
        this.values.set(legacyBalanceKey, Math.floor(Number(this.values.get(balanceKey)) / Number(scale)));
        this.values.set(requestKey, `committed|${actual}`);
        this.values.set(legacyRequestKey, `committed|${Math.floor(actual / Number(scale))}`);
        return JSON.stringify({ status: 'committed' });
    }
    refund([balanceKey, requestKey, legacyBalanceKey, legacyRequestKey], [daily, ttl, scale]) {
        const value = this.values.get(requestKey);
        if (!value) return JSON.stringify({ status: 'missing' });
        const [state, cost] = value.split('|');
        if (state === 'refunded') return JSON.stringify({ status: 'refunded' });
        if (state !== 'reserved' && state !== 'committed') return JSON.stringify({ status: state });
        const remaining = Number(this.values.get(balanceKey) ?? daily) + Number(cost);
        this.values.set(balanceKey, remaining);
        this.values.set(legacyBalanceKey, Math.floor(remaining / Number(scale)));
        this.values.set(requestKey, `refunded|${cost}`);
        this.values.set(legacyRequestKey, `refunded|${Math.floor(Number(cost) / Number(scale))}`);
        return JSON.stringify({ status: 'refunded', remaining });
    }
    schema([usedKey, pendingKey, requestKey, legacyUsedKey], [limit]) {
        if (this.values.has(requestKey)) return JSON.stringify({ status: 'duplicate' });
        const used = Number(this.values.get(usedKey) ?? this.values.get(legacyUsedKey) ?? 0), pending = Number(this.values.get(pendingKey) || 0);
        if (used + pending >= Number(limit)) return JSON.stringify({ status: 'limit', count: used + pending });
        this.values.set(usedKey, used);
        this.values.set(pendingKey, pending + 1);
        this.values.set(requestKey, 'reserved');
        this.values.set(legacyUsedKey, used + pending + 1);
        return JSON.stringify({ status: 'allowed', count: used + pending + 1 });
    }
    settleSchema([usedKey, pendingKey, requestKey, legacyUsedKey]) {
        if (this.values.get(requestKey) === 'committed') return 1;
        if (this.values.get(requestKey) !== 'reserved') return 0;
        this.values.set(pendingKey, Math.max(0, Number(this.values.get(pendingKey) || 0) - 1));
        this.values.set(usedKey, Number(this.values.get(usedKey) || 0) + 1);
        this.values.set(legacyUsedKey, Number(this.values.get(usedKey)) + Number(this.values.get(pendingKey) || 0));
        this.values.set(requestKey, 'committed');
        return 1;
    }
    refundSchema([usedKey, pendingKey, requestKey, legacyUsedKey]) {
        if (this.values.get(requestKey) === 'refunded') return 1;
        if (this.values.get(requestKey) !== 'reserved') return 0;
        this.values.set(pendingKey, Math.max(0, Number(this.values.get(pendingKey) || 0) - 1));
        this.values.set(legacyUsedKey, Number(this.values.get(usedKey) || 0) + Number(this.values.get(pendingKey) || 0));
        this.values.set(requestKey, 'refunded');
        return 1;
    }
}

test('daily usage remains 50 old credits and reservations are atomic in milli-credit units', async () => {
    const ledger = createMemoryCreditsLedger();
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => ledger.reserve('ip-a', 1000, `request-${i}-key`)));
    assert.equal(results.filter(result => result.allowed).length, 50);
    assert.equal(await ledger.getRemaining('ip-a'), 0);
    assert.equal((await ledger.reserve('ip-a', 1, 'request-over-limit')).code, 'INSUFFICIENT_USAGE');
    assert.equal(DAILY_USAGE_UNITS, 50_000);
    assert.equal(UNITS_PER_CREDIT, 1000);
});

test('commit and refund are idempotent; failed generations can retry with a new request id', async () => {
    const ledger = createMemoryCreditsLedger();
    const reservation = await ledger.reserve('ip-b', 6000, 'presentation-one');
    assert.equal(reservation.remaining, DAILY_USAGE_UNITS - 6000);
    assert.equal(await ledger.refund(reservation), true);
    assert.equal(await ledger.refund(reservation), false);
    assert.equal(await ledger.getRemaining('ip-b'), DAILY_USAGE_UNITS);
    const retry = await ledger.reserve('ip-b', 6000, 'presentation-retry');
    assert.equal(await ledger.commit(retry, 4000), true);
    assert.equal(await ledger.commit(retry, 4000), true);
    assert.equal(await ledger.getRemaining('ip-b'), DAILY_USAGE_UNITS - 4000);
    assert.equal((await ledger.reserve('ip-b', 6000, 'presentation-retry')).code, 'USAGE_REQUEST_ALREADY_APPLIED');
});

test('partial slide delivery settles only delivered slide units', async () => {
    const ledger = createMemoryCreditsLedger();
    const reservation = await ledger.reserve('ip-partial', 10_000, 'partial-generation');
    assert.equal(await ledger.commit(reservation, 4000), true);
    assert.equal(await ledger.getRemaining('ip-partial'), DAILY_USAGE_UNITS - 4000);
    assert.equal(await ledger.commit(reservation, 0), true);
});

test('legacy Redis balances migrate once at 1 old credit = 1000 units and retain request idempotency', async () => {
    const redis = new AtomicRedisMock();
    const ledger = createCreditsLedger({ redis: () => redis });
    const keys = ledger.makeKeys('migration-ip', 'legacy-request', new Date('2026-10-13T12:00:00Z'));
    redis.values.set(keys.legacyBalanceKey, '44');
    redis.values.set(keys.legacyRequestKey, 'committed|6');
    assert.equal(await ledger.getRemaining('migration-ip', new Date('2026-10-13T12:00:00Z')), 44_000);
    assert.equal(await ledger.getRemaining('migration-ip', new Date('2026-10-13T12:01:00Z')), 44_000);
    const duplicate = await ledger.reserve('migration-ip', 1000, 'legacy-request', new Date('2026-10-13T12:00:00Z'));
    assert.equal(duplicate.allowed, false);
    assert.equal(duplicate.code, 'USAGE_REQUEST_ALREADY_APPLIED');
});

test('Redis migration and shadow writes preserve consumption if the previous release is rolled back', async () => {
    const redis = new AtomicRedisMock();
    const ledger = createCreditsLedger({ redis: () => redis });
    const date = new Date('2026-10-13T12:00:00Z');
    const reservation = await ledger.reserve('rollback-ip', 1500, 'generation-after-upgrade', date);
    assert.equal(reservation.remaining, DAILY_USAGE_UNITS - 1500);
    assert.equal(Number(redis.values.get(reservation.keys.legacyBalanceKey)), 48);
    assert.equal(redis.values.get(reservation.keys.legacyRequestKey), 'reserved|1');
    assert.equal(await ledger.commit(reservation, 1250), true);
    assert.equal(Number(redis.values.get(reservation.keys.legacyBalanceKey)), 48);
    assert.equal(redis.values.get(reservation.keys.legacyRequestKey), 'committed|1');

    const legacySchemaKey = reservation.keys.legacySchemaKey;
    redis.values.set(legacySchemaKey, '6');
    const schema = await ledger.reserveSchemaRequest('rollback-ip', 'new-schema', date);
    assert.equal(schema.status, 'allowed');
    assert.equal(Number(redis.values.get(legacySchemaKey)), 7);
    assert.equal(await ledger.refundSchemaRequest(schema), true);
    assert.equal(Number(redis.values.get(legacySchemaKey)), 6);
});

test('usage and schema quota use UTC dates and reset at midnight UTC', async () => {
    const redis = new AtomicRedisMock();
    const now = new Date('2026-10-13T23:59:00.000Z');
    const ledger = createCreditsLedger({ redis: () => redis, now: () => now });
    assert.equal(utcDay(now), '2026-10-13');
    assert.equal(resetAt(now).toISOString(), '2026-10-14T00:00:00.000Z');
    for (let i = 0; i < 10; i++) assert.equal((await ledger.reserveSchemaRequest('ip-c')).status, 'allowed');
    assert.equal((await ledger.reserveSchemaRequest('ip-c')).status, 'limit');
    assert.equal(await ledger.getRemaining('ip-c'), DAILY_USAGE_UNITS);
    assert.equal(await ledger.getRemaining('ip-c', new Date('2026-10-14T00:00:00.000Z')), DAILY_USAGE_UNITS);
});

test('the same idempotency key cannot reserve usage again after midnight UTC', async () => {
    const ledger = createMemoryCreditsLedger();
    const first = await ledger.reserve('ip-cross-day', 10_000, 'stable-generation-id', new Date('2026-10-13T23:59:59.000Z'));
    assert.equal(first.remaining, DAILY_USAGE_UNITS - 10_000);
    await ledger.refund(first);
    const retry = await ledger.reserve('ip-cross-day', 10_000, 'stable-generation-id', new Date('2026-10-14T00:00:01.000Z'));
    assert.equal(retry.allowed, false);
    assert.equal(retry.code, 'USAGE_REQUEST_ALREADY_APPLIED');
});

test('Redis failure blocks balance reads and reservations', async () => {
    const ledger = createCreditsLedger({ redis: () => null });
    await assert.rejects(ledger.getRemaining('ip-d'), { message: 'CREDITS_UNAVAILABLE' });
    await assert.rejects(ledger.reserve('ip-d', 1, 'request-down'), { message: 'CREDITS_UNAVAILABLE' });
    await assert.rejects(ledger.spend('ip-d', 1, 'spend-down'), { message: 'CREDITS_UNAVAILABLE' });
    await assert.rejects(ledger.reserveSchemaRequest('ip-d'), { message: 'CREDITS_UNAVAILABLE' });
});
