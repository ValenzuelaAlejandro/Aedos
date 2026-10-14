'use strict';

const crypto = require('node:crypto');
const { getRedis, resolveClientIp } = require('./rate-limiter');
const { spendGuard } = require('./spend-guard');

const DAILY_CREDITS = 50;
const DAILY_SCHEMA_REQUESTS = 10;
const RETENTION_AFTER_RESET_SEC = 24 * 60 * 60;

const RESERVE_SCRIPT = `
local old = redis.call('GET', KEYS[2])
if old then
  local status, oldCost = string.match(old, '([^|]+)|(%d+)')
  return cjson.encode({status='duplicate', state=status, cost=tonumber(oldCost), remaining=tonumber(redis.call('GET', KEYS[1]) or ARGV[1])})
end
local remaining = redis.call('GET', KEYS[1])
if not remaining then
  remaining = tonumber(ARGV[1])
  redis.call('SET', KEYS[1], remaining, 'EX', ARGV[3])
else
  remaining = tonumber(remaining)
end
local cost = tonumber(ARGV[2])
if cost > remaining then
  return cjson.encode({status='insufficient', remaining=remaining})
end
remaining = redis.call('DECRBY', KEYS[1], cost)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('SET', KEYS[2], 'reserved|' .. cost, 'EX', ARGV[3])
return cjson.encode({status='reserved', remaining=remaining})`;

const SETTLE_SCRIPT = `
local old = redis.call('GET', KEYS[2])
if not old then return cjson.encode({status='missing'}) end
local state, cost = string.match(old, '([^|]+)|(%d+)')
if state == 'committed' then return cjson.encode({status='committed'}) end
if state ~= 'reserved' then return cjson.encode({status=state or 'invalid'}) end
redis.call('SET', KEYS[2], 'committed|' .. cost, 'KEEPTTL')
return cjson.encode({status='committed'})`;

const REFUND_SCRIPT = `
local old = redis.call('GET', KEYS[2])
if not old then return cjson.encode({status='missing'}) end
local state, cost = string.match(old, '([^|]+)|(%d+)')
if state == 'refunded' then return cjson.encode({status='refunded'}) end
if state ~= 'reserved' and state ~= 'committed' then return cjson.encode({status=state or 'invalid'}) end
local remaining = redis.call('GET', KEYS[1])
if not remaining then remaining = tonumber(ARGV[1]) end
remaining = redis.call('INCRBY', KEYS[1], tonumber(cost))
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], 'refunded|' .. cost, 'KEEPTTL')
return cjson.encode({status='refunded', remaining=remaining})`;

const SPEND_SCRIPT = `
local old = redis.call('GET', KEYS[2])
if old then return cjson.encode({status='duplicate', remaining=tonumber(redis.call('GET', KEYS[1]) or ARGV[1])}) end
local remaining = redis.call('GET', KEYS[1])
if not remaining then
  remaining = tonumber(ARGV[1])
  redis.call('SET', KEYS[1], remaining, 'EX', ARGV[3])
else
  remaining = tonumber(remaining)
end
local cost = tonumber(ARGV[2])
if cost > remaining then return cjson.encode({status='insufficient', remaining=remaining}) end
remaining = redis.call('DECRBY', KEYS[1], cost)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('SET', KEYS[2], 'committed|' .. cost, 'EX', ARGV[3])
return cjson.encode({status='spent', remaining=remaining})`;

const SCHEMA_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return cjson.encode({status='limit', count=count}) end
count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return cjson.encode({status='allowed', count=count})`;

function utcDay(date) {
    return new Date(date).toISOString().slice(0, 10);
}

function resetAt(date) {
    const current = new Date(date);
    return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1));
}

function parseResult(value) {
    return typeof value === 'string' ? JSON.parse(value) : value;
}

function createCreditsLedger({ redis = getRedis, now = () => new Date(), daily = DAILY_CREDITS, schemaDaily = DAILY_SCHEMA_REQUESTS } = {}) {
    function makeKeys(ip, id, date = now()) {
        const day = utcDay(date);
        const ipHash = crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');
        const tag = `{aedos-credits-${ipHash}}`;
        const ttl = Math.max(60, Math.ceil((resetAt(date).getTime() - new Date(date).getTime()) / 1000)
            + RETENTION_AFTER_RESET_SEC);
        return {
            day,
            ttl,
            balanceKey: `${tag}:balance:${day}`,
            requestKey: `${tag}:request:${id}`,
            schemaKey: `${tag}:schema:${day}`,
        };
    }

    async function getRemaining(ip, date = now()) {
        const client = redis();
        if (!client) throw new Error('CREDITS_UNAVAILABLE');
        const { balanceKey } = makeKeys(ip, 'read', date);
        const value = await client.get(balanceKey);
        return value === null || value === undefined ? daily : Number(value);
    }

    async function reserve(ip, cost, id, date = now()) {
        if (!Number.isSafeInteger(cost) || cost < 0 || !id) throw new Error('INVALID_CREDIT_RESERVATION');
        const client = redis();
        if (!client) throw new Error('CREDITS_UNAVAILABLE');
        const keys = makeKeys(ip, id, date);
        const result = parseResult(await client.eval(RESERVE_SCRIPT, [keys.balanceKey, keys.requestKey],
            [String(daily), String(cost), String(keys.ttl)]));
        if (result.status === 'reserved') return { allowed: true, duplicate: false, remaining: result.remaining, keys, cost };
        if (result.status === 'insufficient') return { allowed: false, code: 'INSUFFICIENT_CREDITS', remaining: result.remaining, cost };
        return { allowed: false, code: 'IDEMPOTENCY_KEY_REUSED', remaining: result.remaining, state: result.state, cost: result.cost };
    }

    async function commit(reservation) {
        if (!reservation?.allowed) return false;
        const client = redis();
        if (!client) return false;
        const result = parseResult(await client.eval(SETTLE_SCRIPT,
            [reservation.keys.balanceKey, reservation.keys.requestKey], []));
        return result.status === 'committed';
    }

    async function refund(reservation) {
        if (!reservation?.allowed) return false;
        const client = redis();
        if (!client) return false;
        const result = parseResult(await client.eval(REFUND_SCRIPT,
            [reservation.keys.balanceKey, reservation.keys.requestKey], [String(daily), String(reservation.keys.ttl)]));
        return result.status === 'refunded';
    }

    async function spend(ip, cost, id, date = now()) {
        if (!Number.isSafeInteger(cost) || cost <= 0 || !id) throw new Error('INVALID_CREDIT_SPEND');
        const client = redis();
        if (!client) throw new Error('CREDITS_UNAVAILABLE');
        const keys = makeKeys(ip, id, date);
        const result = parseResult(await client.eval(SPEND_SCRIPT, [keys.balanceKey, keys.requestKey],
            [String(daily), String(cost), String(keys.ttl)]));
        return { ...result, cost, resetsAt: resetAt(date).toISOString() };
    }

    async function reserveSchemaRequest(ip, date = now()) {
        const client = redis();
        if (!client) throw new Error('CREDITS_UNAVAILABLE');
        const keys = makeKeys(ip, 'schema', date);
        const result = parseResult(await client.eval(SCHEMA_SCRIPT, [keys.schemaKey],
            [String(schemaDaily), String(keys.ttl)]));
        return { ...result, limit: schemaDaily, resetsAt: resetAt(date).toISOString() };
    }

    return Object.freeze({ daily, schemaDaily, getRemaining, reserve, commit, refund, spend, reserveSchemaRequest, makeKeys });
}

function createMemoryCreditsLedger({ now = () => new Date(), daily = DAILY_CREDITS, schemaDaily = DAILY_SCHEMA_REQUESTS } = {}) {
    const balances = new Map();
    const requests = new Map();
    const schemaCounts = new Map();
    function keys(ip, id, date = now()) {
        const day = utcDay(date);
        const owner = crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');
        return { day, balanceKey: `${owner}:${day}`, requestKey: `${owner}:${id}`,
            schemaKey: `${owner}:${day}`, ttl: 0 };
    }
    async function getRemaining(ip, date = now()) {
        return balances.get(keys(ip, 'read', date).balanceKey) ?? daily;
    }
    async function reserve(ip, cost, id, date = now()) {
        const entryKeys = keys(ip, id, date);
        if (requests.has(entryKeys.requestKey)) return { allowed: false, code: 'IDEMPOTENCY_KEY_REUSED' };
        const remaining = balances.get(entryKeys.balanceKey) ?? daily;
        if (cost > remaining) return { allowed: false, code: 'INSUFFICIENT_CREDITS', remaining, cost };
        balances.set(entryKeys.balanceKey, remaining - cost);
        const reservation = { allowed: true, keys: entryKeys, cost, status: 'reserved' };
        requests.set(entryKeys.requestKey, reservation);
        return { ...reservation, remaining: remaining - cost };
    }
    async function commit(reservation) {
        const existing = requests.get(reservation?.keys?.requestKey);
        if (!existing) return false;
        if (existing.status === 'committed') return true;
        if (existing.status !== 'reserved') return false;
        existing.status = 'committed';
        return true;
    }
    async function refund(reservation) {
        const existing = requests.get(reservation?.keys?.requestKey);
        if (!existing || existing.status === 'refunded') return false;
        if (existing.status !== 'reserved' && existing.status !== 'committed') return false;
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
    async function reserveSchemaRequest(ip, date = now()) {
        const entryKeys = keys(ip, 'schema', date);
        const count = schemaCounts.get(entryKeys.schemaKey) || 0;
        if (count >= schemaDaily) return { status: 'limit', count, limit: schemaDaily, resetsAt: resetAt(date).toISOString() };
        schemaCounts.set(entryKeys.schemaKey, count + 1);
        return { status: 'allowed', count: count + 1, limit: schemaDaily, resetsAt: resetAt(date).toISOString() };
    }
    return Object.freeze({ daily, schemaDaily, getRemaining, reserve, commit, refund, spend,
        reserveSchemaRequest, makeKeys: keys });
}

function readRequestId(req) {
    const value = req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'] || req.body?.requestId;
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(value)) return null;
    return value;
}

function getRequestIp(req) {
    return resolveClientIp(req);
}

module.exports = {
    DAILY_CREDITS,
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
