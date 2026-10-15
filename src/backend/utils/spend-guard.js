'use strict';

const crypto = require('node:crypto');
const { getRedis } = require('./rate-limiter');
const { spendConfig } = require('../config/provider-spend');
const { getProviderSpendState, getProviderClientIp } = require('../providers/request-context');

const PAID_PAUSE_KEY = '{aedos-spend}:paused';
const PAID_PAUSE_SECONDS = 60 * 60;
const RESERVATION_TTL_SECONDS = 48 * 60 * 60;

const RESERVE_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 then return -1 end
if redis.call('EXISTS', KEYS[4]) == 1 then return 0 end
local day = tonumber(redis.call('GET', KEYS[1]) or '0')
local month = tonumber(redis.call('GET', KEYS[2]) or '0')
local ipDay = tonumber(redis.call('GET', KEYS[6]) or '0')
local amount = tonumber(ARGV[1])
if day + amount > tonumber(ARGV[2]) or month + amount > tonumber(ARGV[3]) then return -2 end
if ipDay + amount > tonumber(ARGV[5]) then return -3 end
redis.call('INCRBY', KEYS[1], amount)
redis.call('INCRBY', KEYS[2], amount)
redis.call('INCRBY', KEYS[6], amount)
redis.call('EXPIRE', KEYS[1], 172800)
redis.call('EXPIRE', KEYS[2], 3024000)
redis.call('EXPIRE', KEYS[6], 172800)
redis.call('SET', KEYS[4], 'reserved|' .. amount, 'EX', ARGV[4])
return 1`;

const PAUSE_PAID_SCRIPT = `redis.call('SET', KEYS[1], '1', 'EX', ARGV[1]); return 1`;

const SETTLE_SCRIPT = `
local existing = redis.call('GET', KEYS[4])
if not existing then return cjson.encode({status='missing'}) end
local state, reserved = string.match(existing, '([^|]+)|(%d+)')
if state ~= 'reserved' then return cjson.encode({status=state or 'invalid', idempotent=true}) end
local actual = tonumber(ARGV[1])
if not actual or actual < 0 then return cjson.encode({status='invalid_amount'}) end
local delta = actual - tonumber(reserved)
local day = tonumber(redis.call('GET', KEYS[1]) or '0')
local month = tonumber(redis.call('GET', KEYS[2]) or '0')
redis.call('SET', KEYS[1], math.max(0, day + delta), 'KEEPTTL')
redis.call('SET', KEYS[2], math.max(0, month + delta), 'KEEPTTL')
local ipDay = tonumber(redis.call('GET', KEYS[6]) or '0')
redis.call('SET', KEYS[6], math.max(0, ipDay + delta), 'KEEPTTL')
if actual > tonumber(reserved) then
  local overage = actual - tonumber(reserved)
  redis.call('XADD', KEYS[5], 'MAXLEN', '~', 10000, '*',
    'requestId', ARGV[2], 'provider', ARGV[3], 'model', ARGV[4],
    'reservedMicroUsd', reserved, 'actualMicroUsd', actual, 'overageMicroUsd', overage,
    'alert', 'critical', 'action', 'paid_requests_paused')
  redis.call('SET', KEYS[3], '1', 'EX', ARGV[5])
end
redis.call('SET', KEYS[4], 'settled|' .. actual, 'KEEPTTL')
return cjson.encode({status='settled', reserved=tonumber(reserved), actual=actual, overage=actual > tonumber(reserved)})`;

const GEMINI_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1`;

function microUsd(usd) { return Math.ceil(usd * 1_000_000); }
function utcKeys(now) {
    const iso = new Date(now).toISOString();
    return [`{aedos-spend}:day:${iso.slice(0, 10)}`, `{aedos-spend}:month:${iso.slice(0, 7)}`];
}
function pacificDay(now) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function ipSpendKey(ip, now) {
    const digest = crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 24);
    return `{aedos-spend}:ip:${digest}:${new Date(now).toISOString().slice(0, 10)}`;
}

// eslint-disable-next-line max-lines-per-function -- One guard owns budget reservations and settlement across provider attempts.
function createSpendGuard({ redis = getRedis, env = process.env, now = () => new Date(), fetchBalance = global.fetch } = {}) {
    const cfg = spendConfig(env);
    let balanceCache = null;

    async function balanceAllowed() {
        if (!env.OPENROUTER_MANAGEMENT_KEY) return true;
        if (!balanceCache || balanceCache.expires < Date.now()) {
            const response = await fetchBalance('https://openrouter.ai/api/v1/credits', {
                headers: { Authorization: `Bearer ${env.OPENROUTER_MANAGEMENT_KEY}` },
            });
            if (!response.ok) throw new Error('BALANCE_UNAVAILABLE');
            const data = (await response.json()).data;
            if (!Number.isFinite(data?.total_credits) || !Number.isFinite(data?.total_usage)) throw new Error('BALANCE_UNAVAILABLE');
            balanceCache = { amount: data.total_credits - data.total_usage, expires: Date.now() + 60000 };
        }
        return balanceCache.amount - cfg.dailyUsd >= cfg.balanceFloorUsd;
    }

    // eslint-disable-next-line complexity -- Each fail-closed cap is checked before the atomic Redis reservation.
    async function reserve(estimatedUsd, { provider = 'openrouter', model = null, requestId = null } = {}) {
        if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) return { allowed: false, reason: 'INVALID_ESTIMATE' };
        const state = getProviderSpendState();
        if (state) {
            state.attemptCount = Number(state.attemptCount) || 0;
            if (!Number.isFinite(state.startedAt)) state.startedAt = Date.now();
            if (!state.clientIp) state.clientIp = getProviderClientIp();
        }
        if (state && Date.now() - state.startedAt >= cfg.maxRequestDurationMs) {
            return { allowed: false, reason: 'REQUEST_TIMEOUT' };
        }
        if (state && state.attemptCount >= cfg.maxProviderAttempts) {
            return { allowed: false, reason: 'REQUEST_ATTEMPT_LIMIT' };
        }
        const amount = microUsd(estimatedUsd * cfg.reservationMargin);
        const requestLimit = microUsd(cfg.maxRequestReservationUsd);
        if (amount > requestLimit || (state && state.reservedMicroUsd + state.settledMicroUsd + amount > requestLimit)) {
            return { allowed: false, reason: 'REQUEST_SPEND_LIMIT' };
        }
        try {
            const client = redis();
            if (!client) return { allowed: false, reason: 'SPEND_GUARD_UNAVAILABLE' };
            if (provider === 'openrouter' && !(await balanceAllowed())) {
                return { allowed: false, reason: 'GLOBAL_SPEND_LIMIT' };
            }
            const currentTime = now();
            const keys = [...utcKeys(currentTime), PAID_PAUSE_KEY,
                `{aedos-spend}:reservation:${crypto.randomUUID()}`, '{aedos-spend}:overages',
                ipSpendKey(state?.clientIp || getProviderClientIp(), currentTime)];
            const allowed = await client.eval(RESERVE_SCRIPT, keys,
                [String(amount), String(microUsd(cfg.dailyUsd)), String(microUsd(cfg.monthlyUsd)),
                    String(RESERVATION_TTL_SECONDS), String(microUsd(cfg.perIpDailyUsd))]);
            const result = Number(allowed);
            if (result !== 1) {
                const reason = result === -3 ? 'IP_SPEND_LIMIT'
                    : result === -1 || result === -2 ? 'GLOBAL_SPEND_LIMIT' : 'DUPLICATE_RESERVATION';
                return { allowed: false, reason };
            }
            if (state) { state.reservedMicroUsd += amount; state.attemptCount += 1; }
            return { allowed: true, keys, amount, provider, model, requestId, state, ip: state?.clientIp || getProviderClientIp() };
        } catch (_) { return { allowed: false, reason: 'SPEND_GUARD_UNAVAILABLE' }; }
    }

    async function settle(reservation, actualUsd) {
        if (!reservation?.allowed) return false;
        const actual = microUsd(Math.max(0, actualUsd));
        try {
            const client = redis();
            if (!client) return false;
            const result = await client.eval(SETTLE_SCRIPT, reservation.keys,
                [String(actual), String(reservation.requestId || ''), String(reservation.provider || ''),
                    String(reservation.model || ''), String(PAID_PAUSE_SECONDS)]);
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            if (parsed?.status !== 'settled') return parsed?.status === 'settled';
            if (parsed.idempotent) return true;
            if (reservation.state) {
                reservation.state.reservedMicroUsd = Math.max(0, reservation.state.reservedMicroUsd - reservation.amount);
                reservation.state.settledMicroUsd += actual;
            }
            if (actual > reservation.amount) {
                process.stderr.write(`${JSON.stringify({ event: 'provider_spend_overage', requestId: reservation.requestId,
                    provider: reservation.provider, model: reservation.model, reservedUsd: reservation.amount / 1e6,
                    actualUsd: actual / 1e6, overageUsd: (actual - reservation.amount) / 1e6,
                    alert: true, severity: 'critical', action: 'paid_requests_paused' })}\n`);
            }
            return true;
        } catch (_) { return false; }
    }
    async function release(reservation) { return settle(reservation, 0); }

    async function pausePaid() {
        try {
            const client = redis();
            if (!client) return false;
            return Number(await client.eval(PAUSE_PAID_SCRIPT, [PAID_PAUSE_KEY], [String(PAID_PAUSE_SECONDS)])) === 1;
        } catch (_) { return false; }
    }

    async function reserveGeminiRequest() {
        try {
            const client = redis();
            if (!client) return false;
            const key = `{aedos-gemini}:day:${pacificDay(now())}`;
            return Number(await client.eval(GEMINI_SCRIPT, [key], [String(cfg.geminiDailyCap), '172800'])) === 1;
        } catch (_) { return false; }
    }

    async function hasGeminiRequestAvailable() {
        try {
            const client = redis();
            if (!client) return false;
            const key = `{aedos-gemini}:day:${pacificDay(now())}`;
            const used = Number(await client.get(key) || 0);
            return Number.isFinite(used) && used < cfg.geminiDailyCap;
        } catch (_) { return false; }
    }

    async function getSpendStatus() {
        try {
            const client = redis();
            if (!client) return { paidPaused: true, spendPaused: true, reason: 'redis_unavailable' };
            const currentTime = now();
            const [day, month, paused, ipDay] = await Promise.all([...utcKeys(currentTime), PAID_PAUSE_KEY,
                ipSpendKey(getProviderClientIp(), currentTime)].map(key => client.get(key)));
            const dayUsed = Number(day || 0), monthUsed = Number(month || 0);
            const capped = Boolean(paused) || dayUsed >= microUsd(cfg.dailyUsd) || monthUsed >= microUsd(cfg.monthlyUsd);
            return { paidPaused: capped || !env.OPENROUTER_API_KEY, spendPaused: capped,
                dailyUsd: cfg.dailyUsd, monthlyUsd: cfg.monthlyUsd, perIpDailyUsd: cfg.perIpDailyUsd,
                dailyUsedUsd: dayUsed / 1_000_000, monthlyUsedUsd: monthUsed / 1_000_000,
                ipDailyUsedUsd: Number(ipDay || 0) / 1_000_000 };
        } catch (_) { return { paidPaused: true, spendPaused: true, reason: 'spend_guard_unavailable' }; }
    }
    return { reserve, settle, release, pausePaid, reserveGeminiRequest, hasGeminiRequestAvailable, getSpendStatus, config: cfg };
}

const guard = createSpendGuard();
module.exports = { createSpendGuard, utcKeys, pacificDay, ipSpendKey, PAID_PAUSE_SECONDS,
    getSpendStatus: guard.getSpendStatus, spendGuard: guard };
