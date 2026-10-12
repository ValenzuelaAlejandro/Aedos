const { getRedis } = require('./rate-limiter');
const { spendConfig } = require('../config/provider-spend');

const RESERVE_SCRIPT = `
local day = tonumber(redis.call('GET', KEYS[1]) or '0')
local month = tonumber(redis.call('GET', KEYS[2]) or '0')
local amount = tonumber(ARGV[1])
if day + amount > tonumber(ARGV[2]) or month + amount > tonumber(ARGV[3]) then return 0 end
redis.call('INCRBY', KEYS[1], amount)
redis.call('INCRBY', KEYS[2], amount)
redis.call('EXPIRE', KEYS[1], 172800)
redis.call('EXPIRE', KEYS[2], 3024000)
return 1`;
const SETTLE_SCRIPT = `
local delta = tonumber(ARGV[1]) - tonumber(ARGV[2])
for i = 1, 2 do
  local value = tonumber(redis.call('GET', KEYS[i]) or '0')
  redis.call('SET', KEYS[i], math.max(0, value + delta), 'KEEPTTL')
end
return 1`;
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

function createSpendGuard({ redis = getRedis, env = process.env, now = () => new Date(), fetchBalance = global.fetch } = {}) {
    const cfg = spendConfig(env);
    let balanceCache = null;

    async function balanceAllowed() {
        if (!env.OPENROUTER_MANAGEMENT_KEY) return true; // /credits requires a management key.
        if (!balanceCache || balanceCache.expires < Date.now()) {
            const response = await fetchBalance('https://openrouter.ai/api/v1/credits', {
                headers: { Authorization: `Bearer ${env.OPENROUTER_MANAGEMENT_KEY}` },
            });
            if (!response.ok) throw new Error('BALANCE_UNAVAILABLE');
            const data = (await response.json()).data;
            if (!Number.isFinite(data?.total_credits) || !Number.isFinite(data?.total_usage)) throw new Error('BALANCE_UNAVAILABLE');
            balanceCache = { amount: data.total_credits - data.total_usage, expires: Date.now() + 60000 };
        }
        // Hold one entire daily allowance as a buffer because this value is cached for 60s.
        return balanceCache.amount - cfg.dailyUsd >= cfg.balanceFloorUsd;
    }

    async function reserve(estimatedUsd) {
        if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) return { allowed: false };
        try {
            const client = redis();
            if (!client || !(await balanceAllowed())) return { allowed: false };
            const keys = utcKeys(now());
            const amount = microUsd(estimatedUsd);
            const allowed = await client.eval(RESERVE_SCRIPT, keys,
                [String(amount), String(microUsd(cfg.dailyUsd)), String(microUsd(cfg.monthlyUsd))]);
            return { allowed: Number(allowed) === 1, keys, amount };
        } catch (_) { return { allowed: false }; } // Paid usage always fails closed.
    }

    async function settle(reservation, actualUsd) {
        if (!reservation?.allowed) return false;
        try {
            const client = redis();
            if (!client) return false;
            await client.eval(SETTLE_SCRIPT, reservation.keys,
                [String(microUsd(Math.max(0, actualUsd))), String(reservation.amount)]);
            return true;
        } catch (_) { return false; }
    }
    async function release(reservation) { return settle(reservation, 0); }

    async function reserveGeminiRequest() {
        try {
            const client = redis();
            if (!client) return false;
            const key = `{aedos-gemini}:day:${pacificDay(now())}`;
            // 48h TTL safely spans either 23h or 25h Pacific days at DST changes.
            return Number(await client.eval(GEMINI_SCRIPT, [key], [String(cfg.geminiDailyCap), '172800'])) === 1;
        } catch (_) { return false; }
    }

    async function getSpendStatus() {
        try {
            const client = redis();
            if (!client || !(await balanceAllowed())) return { paidPaused: true };
            const [day, month] = await Promise.all(utcKeys(now()).map(key => client.get(key)));
            return { paidPaused: Number(day || 0) >= microUsd(cfg.dailyUsd)
                || Number(month || 0) >= microUsd(cfg.monthlyUsd) };
        } catch (_) { return { paidPaused: true }; }
    }
    return { reserve, settle, release, reserveGeminiRequest, getSpendStatus };
}

const guard = createSpendGuard();
module.exports = { createSpendGuard, utcKeys, pacificDay, getSpendStatus: guard.getSpendStatus, spendGuard: guard };
