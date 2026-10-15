'use strict';

const crypto = require('node:crypto');
const { getRedis, resolveClientIp } = require('./rate-limiter');
const { DAILY_USAGE_UNITS, LEGACY_CREDITS_PER_DAY, UNITS_PER_CREDIT } = require('../config/usage-policy');
const { spendGuard } = require('./spend-guard');

const DAILY_CREDITS = LEGACY_CREDITS_PER_DAY; // legacy migration/documentation compatibility only
const DAILY_USAGE = DAILY_USAGE_UNITS;
const DAILY_SCHEMA_REQUESTS = 10;
const RETENTION_AFTER_RESET_SEC = 24 * 60 * 60;

const MIGRATE_BALANCE = `
local remaining = redis.call('GET', KEYS[1])
if not remaining then
  local legacy = redis.call('GET', KEYS[2])
  remaining = legacy and (tonumber(legacy) * tonumber(ARGV[4])) or tonumber(ARGV[1])
  redis.call('SET', KEYS[1], remaining, 'EX', ARGV[3])
  if not legacy then redis.call('SET', KEYS[2], math.floor(remaining / tonumber(ARGV[4])), 'EX', ARGV[3]) end
else
  remaining = tonumber(remaining)
end`;

const GET_SCRIPT = `${MIGRATE_BALANCE}\nreturn remaining`;
const RESERVE_SCRIPT = `${MIGRATE_BALANCE}
local old = redis.call('GET', KEYS[3])
if old or redis.call('EXISTS', KEYS[4]) == 1 then
  return cjson.encode({status='duplicate', remaining=remaining})
end
local cost = tonumber(ARGV[2])
if cost > remaining then return cjson.encode({status='insufficient', remaining=remaining}) end
remaining = redis.call('DECRBY', KEYS[1], cost)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('SET', KEYS[2], math.floor(remaining / tonumber(ARGV[4])), 'EX', ARGV[3])
redis.call('SET', KEYS[3], 'reserved|' .. cost, 'EX', ARGV[3])
redis.call('SET', KEYS[4], 'reserved|' .. math.floor(cost / tonumber(ARGV[4])), 'EX', ARGV[3])
return cjson.encode({status='reserved', remaining=remaining})`;

const SETTLE_SCRIPT = `
local old = redis.call('GET', KEYS[2])
if not old then return cjson.encode({status='missing'}) end
local state, cost = string.match(old, '([^|]+)|(%d+)')
if state == 'committed' then return cjson.encode({status='committed'}) end
if state ~= 'reserved' then return cjson.encode({status=state or 'invalid'}) end
local actual = tonumber(ARGV[1] or cost)
if not actual or actual < 0 or actual > tonumber(cost) then return cjson.encode({status='invalid_amount'}) end
if actual < tonumber(cost) then redis.call('INCRBY', KEYS[1], tonumber(cost) - actual) end
local remaining = tonumber(redis.call('GET', KEYS[1]) or '0')
redis.call('SET', KEYS[3], math.floor(remaining / tonumber(ARGV[2])), 'KEEPTTL')
redis.call('SET', KEYS[2], 'committed|' .. actual, 'KEEPTTL')
redis.call('SET', KEYS[4], 'committed|' .. math.floor(actual / tonumber(ARGV[2])), 'KEEPTTL')
return cjson.encode({status='committed', cost=actual})`;

const REFUND_SCRIPT = `
local old = redis.call('GET', KEYS[2])
if not old then return cjson.encode({status='missing'}) end
local state, cost = string.match(old, '([^|]+)|(%d+)')
if state == 'refunded' then return cjson.encode({status='refunded'}) end
if state ~= 'reserved' and state ~= 'committed' then return cjson.encode({status=state or 'invalid'}) end
local remaining = tonumber(redis.call('GET', KEYS[1]) or ARGV[1])
remaining = redis.call('INCRBY', KEYS[1], tonumber(cost))
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('SET', KEYS[3], math.floor(remaining / tonumber(ARGV[3])), 'EX', ARGV[2])
redis.call('SET', KEYS[2], 'refunded|' .. cost, 'KEEPTTL')
redis.call('SET', KEYS[4], 'refunded|' .. math.floor(tonumber(cost) / tonumber(ARGV[3])), 'KEEPTTL')
return cjson.encode({status='refunded', remaining=remaining})`;

const SPEND_SCRIPT = `${MIGRATE_BALANCE}
local old = redis.call('GET', KEYS[3])
if old or redis.call('EXISTS', KEYS[4]) == 1 then return cjson.encode({status='duplicate', remaining=remaining}) end
local cost = tonumber(ARGV[2])
if cost > remaining then return cjson.encode({status='insufficient', remaining=remaining}) end
remaining = redis.call('DECRBY', KEYS[1], cost)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('SET', KEYS[2], math.floor(remaining / tonumber(ARGV[4])), 'EX', ARGV[3])
redis.call('SET', KEYS[3], 'committed|' .. cost, 'EX', ARGV[3])
redis.call('SET', KEYS[4], 'committed|' .. math.floor(cost / tonumber(ARGV[4])), 'EX', ARGV[3])
return cjson.encode({status='spent', remaining=remaining})`;

const RESERVE_SCHEMA_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 then return cjson.encode({status='duplicate'}) end
local used = tonumber(redis.call('GET', KEYS[1]) or redis.call('GET', KEYS[4]) or '0')
local pending = tonumber(redis.call('GET', KEYS[2]) or '0')
if used + pending >= tonumber(ARGV[1]) then return cjson.encode({status='limit', count=used + pending}) end
redis.call('SET', KEYS[1], used, 'EX', ARGV[2])
pending = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[2])
redis.call('SET', KEYS[3], 'reserved', 'EX', ARGV[2])
redis.call('SET', KEYS[4], used + pending, 'EX', ARGV[2])
return cjson.encode({status='allowed', count=used + pending})`;
const SETTLE_SCHEMA_SCRIPT = `
local state = redis.call('GET', KEYS[3])
if state == 'committed' then return 1 end
if state ~= 'reserved' then return 0 end
redis.call('DECR', KEYS[2])
local used = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])
local pending = tonumber(redis.call('GET', KEYS[2]) or '0')
redis.call('SET', KEYS[4], used + pending, 'EX', ARGV[1])
redis.call('SET', KEYS[3], 'committed', 'KEEPTTL')
return 1`;
const REFUND_SCHEMA_SCRIPT = `
local state = redis.call('GET', KEYS[3])
if state == 'refunded' then return 1 end
if state ~= 'reserved' then return 0 end
local pending = tonumber(redis.call('GET', KEYS[2]) or '0')
if pending > 0 then redis.call('DECR', KEYS[2]) end
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
pending = tonumber(redis.call('GET', KEYS[2]) or '0')
redis.call('SET', KEYS[4], used + pending, 'KEEPTTL')
redis.call('SET', KEYS[3], 'refunded', 'KEEPTTL')
return 1`;

function utcDay(date) { return new Date(date).toISOString().slice(0, 10); }
function resetAt(date) {
    const current = new Date(date);
    return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1));
}
function parseResult(value) { return typeof value === 'string' ? JSON.parse(value) : value; }

// eslint-disable-next-line max-lines-per-function -- The Redis ledger groups its atomic operations behind one injected client.
function createCreditsLedger({ redis = getRedis, now = () => new Date(), daily = DAILY_USAGE,
    schemaDaily = DAILY_SCHEMA_REQUESTS } = {}) {
    function makeKeys(ip, id, date = now()) {
        const day = utcDay(date);
        const ipHash = crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');
        const tag = `{aedos-credits-${ipHash}}`;
        const ttl = Math.max(60, Math.ceil((resetAt(date).getTime() - new Date(date).getTime()) / 1000)
            + RETENTION_AFTER_RESET_SEC);
        return { day, ttl, balanceKey: `${tag}:usage-v2:${day}`, legacyBalanceKey: `${tag}:balance:${day}`,
            requestKey: `${tag}:usage-v2-request:${id}`, legacyRequestKey: `${tag}:request:${id}`,
            schemaKey: `${tag}:schema-v2:${day}`, legacySchemaKey: `${tag}:schema:${day}`,
            schemaPendingKey: `${tag}:schema-v2-pending:${day}`,
            schemaRequestKey: `${tag}:schema-v2-request:${id}` };
    }

    async function getRemaining(ip, date = now()) {
        const client = redis();
        if (!client) throw new Error('CREDITS_UNAVAILABLE');
        const keys = makeKeys(ip, 'read', date);
        return Number(await client.eval(GET_SCRIPT, [keys.balanceKey, keys.legacyBalanceKey],
            [String(daily), '0', String(keys.ttl), String(UNITS_PER_CREDIT)]));
    }

    async function reserve(ip, cost, id, date = now()) {
        if (!Number.isSafeInteger(cost) || cost < 0 || !id) throw new Error('INVALID_USAGE_RESERVATION');
        const client = redis();
        if (!client) throw new Error('CREDITS_UNAVAILABLE');
        const keys = makeKeys(ip, id, date);
        const result = parseResult(await client.eval(RESERVE_SCRIPT,
            [keys.balanceKey, keys.legacyBalanceKey, keys.requestKey, keys.legacyRequestKey],
            [String(daily), String(cost), String(keys.ttl), String(UNITS_PER_CREDIT)]));
        if (result.status === 'reserved') return { allowed: true, duplicate: false, remaining: result.remaining, keys, cost };
        if (result.status === 'insufficient') return { allowed: false, code: 'INSUFFICIENT_USAGE', remaining: result.remaining, cost };
        return { allowed: false, code: 'USAGE_REQUEST_ALREADY_APPLIED', remaining: result.remaining };
    }

    async function commit(reservation, actualCost = reservation?.cost) {
        if (!reservation?.allowed) return false;
        if (!Number.isSafeInteger(actualCost) || actualCost < 0 || actualCost > reservation.cost) return false;
        const client = redis();
        if (!client) return false;
        const result = parseResult(await client.eval(SETTLE_SCRIPT,
            [reservation.keys.balanceKey, reservation.keys.requestKey, reservation.keys.legacyBalanceKey,
                reservation.keys.legacyRequestKey], [String(actualCost), String(UNITS_PER_CREDIT)]));
        return result.status === 'committed';
    }

    async function refund(reservation) {
        if (!reservation?.allowed) return false;
        const client = redis();
        if (!client) return false;
        const result = parseResult(await client.eval(REFUND_SCRIPT,
            [reservation.keys.balanceKey, reservation.keys.requestKey, reservation.keys.legacyBalanceKey,
                reservation.keys.legacyRequestKey], [String(daily), String(reservation.keys.ttl), String(UNITS_PER_CREDIT)]));
        return result.status === 'refunded';
    }

    async function spend(ip, cost, id, date = now()) {
        if (!Number.isSafeInteger(cost) || cost <= 0 || !id) throw new Error('INVALID_USAGE_SPEND');
        const client = redis();
        if (!client) throw new Error('CREDITS_UNAVAILABLE');
        const keys = makeKeys(ip, id, date);
        const result = parseResult(await client.eval(SPEND_SCRIPT,
            [keys.balanceKey, keys.legacyBalanceKey, keys.requestKey, keys.legacyRequestKey],
            [String(daily), String(cost), String(keys.ttl), String(UNITS_PER_CREDIT)]));
        return { ...result, cost, resetsAt: resetAt(date).toISOString() };
    }

    async function reserveSchemaRequest(ip, id = crypto.randomUUID(), date = now()) {
        const client = redis();
        if (!client) throw new Error('CREDITS_UNAVAILABLE');
        const keys = makeKeys(ip, id, date);
        const result = parseResult(await client.eval(RESERVE_SCHEMA_SCRIPT,
            [keys.schemaKey, keys.schemaPendingKey, keys.schemaRequestKey, keys.legacySchemaKey], [String(schemaDaily), String(keys.ttl)]));
        return { ...result, limit: schemaDaily, resetsAt: resetAt(date).toISOString(), keys };
    }

    async function commitSchemaRequest(reservation) {
        if (!reservation?.keys) return false;
        const client = redis();
        if (!client) return false;
        return Number(await client.eval(SETTLE_SCHEMA_SCRIPT,
            [reservation.keys.schemaKey, reservation.keys.schemaPendingKey, reservation.keys.schemaRequestKey,
                reservation.keys.legacySchemaKey],
            [String(reservation.keys.ttl)])) === 1;
    }

    async function refundSchemaRequest(reservation) {
        if (!reservation?.keys) return false;
        const client = redis();
        if (!client) return false;
        return Number(await client.eval(REFUND_SCHEMA_SCRIPT,
            [reservation.keys.schemaKey, reservation.keys.schemaPendingKey, reservation.keys.schemaRequestKey,
                reservation.keys.legacySchemaKey], [])) === 1;
    }

    return Object.freeze({ daily, schemaDaily, getRemaining, reserve, commit, refund, spend,
        reserveSchemaRequest, commitSchemaRequest, refundSchemaRequest, makeKeys });
}

// eslint-disable-next-line max-lines-per-function -- This test ledger mirrors Redis operations for deterministic contract tests.
function createMemoryCreditsLedger({ now = () => new Date(), daily = DAILY_USAGE,
    schemaDaily = DAILY_SCHEMA_REQUESTS } = {}) {
    const balances = new Map(), requests = new Map(), schemaUsed = new Map(), schemaPending = new Map(), schemaRequests = new Map();
    function keys(ip, id, date = now()) {
        const day = utcDay(date);
        const owner = crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');
        return { day, balanceKey: `${owner}:${day}`, requestKey: `${owner}:${id}`, schemaKey: `${owner}:${day}`,
            schemaRequestKey: `${owner}:${id}`, ttl: 0 };
    }
    async function getRemaining(ip, date = now()) { return balances.get(keys(ip, 'read', date).balanceKey) ?? daily; }
    async function reserve(ip, cost, id, date = now()) {
        if (!Number.isSafeInteger(cost) || cost < 0 || !id) throw new Error('INVALID_USAGE_RESERVATION');
        const entryKeys = keys(ip, id, date);
        if (requests.has(entryKeys.requestKey)) return { allowed: false, code: 'USAGE_REQUEST_ALREADY_APPLIED' };
        const remaining = balances.get(entryKeys.balanceKey) ?? daily;
        if (cost > remaining) return { allowed: false, code: 'INSUFFICIENT_USAGE', remaining, cost };
        balances.set(entryKeys.balanceKey, remaining - cost);
        const reservation = { allowed: true, keys: entryKeys, cost, status: 'reserved' };
        requests.set(entryKeys.requestKey, reservation);
        return { ...reservation, remaining: remaining - cost };
    }
    async function commit(reservation, actualCost = reservation?.cost) {
        if (!Number.isSafeInteger(actualCost) || actualCost < 0 || actualCost > reservation?.cost) return false;
        const existing = requests.get(reservation?.keys?.requestKey);
        if (!existing) return false;
        if (existing.status === 'committed') return true;
        if (existing.status !== 'reserved') return false;
        const refundAmount = existing.cost - actualCost;
        if (refundAmount > 0) balances.set(existing.keys.balanceKey, (balances.get(existing.keys.balanceKey) ?? daily) + refundAmount);
        existing.cost = actualCost; existing.status = 'committed';
        return true;
    }
    async function refund(reservation) {
        const existing = requests.get(reservation?.keys?.requestKey);
        if (!existing || existing.status === 'refunded') return false;
        if (!['reserved', 'committed'].includes(existing.status)) return false;
        balances.set(existing.keys.balanceKey, (balances.get(existing.keys.balanceKey) ?? daily) + existing.cost);
        existing.status = 'refunded';
        return true;
    }
    async function spend(ip, cost, id, date = now()) {
        const entryKeys = keys(ip, id, date);
        if (requests.has(entryKeys.requestKey)) return { status: 'duplicate', remaining: await getRemaining(ip, date) };
        const remaining = balances.get(entryKeys.balanceKey) ?? daily;
        if (cost > remaining) return { status: 'insufficient', remaining, cost, resetsAt: resetAt(date).toISOString() };
        balances.set(entryKeys.balanceKey, remaining - cost);
        requests.set(entryKeys.requestKey, { status: 'committed', cost, keys: entryKeys });
        return { status: 'spent', remaining: remaining - cost, cost, resetsAt: resetAt(date).toISOString() };
    }
    async function reserveSchemaRequest(ip, id = crypto.randomUUID(), date = now()) {
        const entryKeys = keys(ip, id, date);
        if (schemaRequests.has(entryKeys.schemaRequestKey)) return { status: 'duplicate', keys: entryKeys, resetsAt: resetAt(date).toISOString() };
        const used = schemaUsed.get(entryKeys.schemaKey) || 0, pending = schemaPending.get(entryKeys.schemaKey) || 0;
        if (used + pending >= schemaDaily) return { status: 'limit', count: used + pending, limit: schemaDaily,
            resetsAt: resetAt(date).toISOString(), keys: entryKeys };
        schemaPending.set(entryKeys.schemaKey, pending + 1);
        const reservation = { status: 'allowed', limit: schemaDaily, keys: entryKeys, resetsAt: resetAt(date).toISOString() };
        schemaRequests.set(entryKeys.schemaRequestKey, { status: 'reserved', reservation });
        return reservation;
    }
    async function commitSchemaRequest(reservation) {
        const current = schemaRequests.get(reservation?.keys?.schemaRequestKey);
        if (!current) return false;
        if (current.status === 'committed') return true;
        if (current.status !== 'reserved') return false;
        current.status = 'committed';
        schemaPending.set(reservation.keys.schemaKey, Math.max(0, (schemaPending.get(reservation.keys.schemaKey) || 0) - 1));
        schemaUsed.set(reservation.keys.schemaKey, (schemaUsed.get(reservation.keys.schemaKey) || 0) + 1);
        return true;
    }
    async function refundSchemaRequest(reservation) {
        const current = schemaRequests.get(reservation?.keys?.schemaRequestKey);
        if (!current || current.status === 'refunded') return false;
        if (current.status !== 'reserved') return false;
        current.status = 'refunded';
        schemaPending.set(reservation.keys.schemaKey, Math.max(0, (schemaPending.get(reservation.keys.schemaKey) || 0) - 1));
        return true;
    }
    return Object.freeze({ daily, schemaDaily, getRemaining, reserve, commit, refund, spend,
        reserveSchemaRequest, commitSchemaRequest, refundSchemaRequest, makeKeys: keys });
}

function readRequestId(req) {
    const value = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'] || req.body?.requestId;
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(value)) return null;
    return value;
}
function getRequestIp(req) { return resolveClientIp(req); }

module.exports = {
    DAILY_CREDITS,
    DAILY_USAGE,
    DAILY_USAGE_UNITS,
    DAILY_SCHEMA_REQUESTS,
    createCreditsLedger,
    createMemoryCreditsLedger,
    readRequestId,
    getRequestIp,
    utcDay,
    resetAt,
    creditsLedger: createCreditsLedger(),
    spendGuard,
};
