/**
 * @typedef {{count: number, expiresAt: number}} ExpiringCounter
 * @typedef {{dailyCounters: Map<string, ExpiringCounter>, cooldowns: Map<string, number>, finalizeCounters: Map<string, ExpiringCounter>}} MemoryState
 * @typedef {{memoryState: MemoryState, dailyTtlSec: number, globalDailyLimit: number, finalizeWindowSec: number, finalizeMax: number}} EvaluatorConfig
 */

/**
 * Create the in-memory and Redis counter decisions used by the Express facade.
 * State and limits are injected so this module owns decisions, not lifecycle.
 *
 * @param {EvaluatorConfig} config
 * @returns {{evaluateGenerateRateLimitMemory: Function, evaluateGenerateRateLimitRedis: Function, evaluateFinalizeRateLimitMemory: Function, evaluateFinalizeRateLimitRedis: Function}}
 */
/* eslint-disable-next-line max-lines-per-function -- this factory only binds shared state and limits; each decision remains an independent helper */
function createRateLimitEvaluators(config) {
    const { memoryState, dailyTtlSec, globalDailyLimit, finalizeWindowSec, finalizeMax } = config;

    function parseCount(value) {
        const n = parseInt(value || '0', 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function retryAfterSec(expiresAt, now = Date.now()) {
        return Math.max(1, Math.ceil((expiresAt - now) / 1000));
    }

    function pruneExpiredMap(map, now = Date.now()) {
        for (const [key, value] of map.entries()) {
            if (typeof value === 'number') {
                if (value <= now) map.delete(key);
                continue;
            }
            if (!value || value.expiresAt <= now) {
                map.delete(key);
            }
        }
    }

    function getOrInitCounter(map, key, ttlSec, now = Date.now()) {
        const existing = map.get(key);
        if (!existing || existing.expiresAt <= now) {
            const created = { count: 0, expiresAt: now + ttlSec * 1000 };
            map.set(key, created);
            return created;
        }
        return existing;
    }

    function evaluateGenerateRateLimitMemory(ip, mode, cfg) {
        const now = Date.now();
        const globalDailyKey = 'ratelimit:daily:global';
        const cooldownKey = `ratelimit:cooldown:${mode}:${ip}`;

        pruneExpiredMap(memoryState.cooldowns, now);
        pruneExpiredMap(memoryState.dailyCounters, now);

        if (cfg.cooldownSec > 0) {
            const cooldownExpiresAt = memoryState.cooldowns.get(cooldownKey);
            if (cooldownExpiresAt && cooldownExpiresAt > now) {
                return {
                    allowed: false,
                    source: 'memory',
                    reason: 'cooldown',
                    statusCode: 429,
                    errorCode: 'COOLDOWN_ACTIVE',
                    retryAfterSec: retryAfterSec(cooldownExpiresAt, now),
                    message: 'Please wait before generating again.',
                };
            }
        }

        const globalCounter = getOrInitCounter(memoryState.dailyCounters, globalDailyKey, dailyTtlSec, now);
        if (globalCounter.count >= globalDailyLimit) {
            return {
                allowed: false,
                source: 'memory',
                reason: 'global_daily_limit',
                statusCode: 429,
                errorCode: 'GLOBAL_DAILY_LIMIT_EXCEEDED',
                retryAfterSec: retryAfterSec(globalCounter.expiresAt, now),
                message: 'System daily generation limit reached. Please try again later.',
                limit: globalDailyLimit,
            };
        }

        globalCounter.count += 1;
        if (cfg.cooldownSec > 0) {
            memoryState.cooldowns.set(cooldownKey, now + cfg.cooldownSec * 1000);
        }

        return {
            allowed: true,
            source: 'memory',
            generationsToday: globalCounter.count,
            globalGenerationsToday: globalCounter.count,
        };
    }

    async function evaluateGenerateRateLimitRedis(client, ip, mode, cfg) {
        const globalDailyKey = 'ratelimit:daily:global';
        const cooldownKey = `ratelimit:cooldown:${mode}:${ip}`;

        if (cfg.cooldownSec > 0) {
            const onCooldown = await client.exists(cooldownKey);
            if (onCooldown) {
                const ttl = await client.ttl(cooldownKey);
                return {
                    allowed: false,
                    source: 'redis',
                    reason: 'cooldown',
                    statusCode: 429,
                    errorCode: 'COOLDOWN_ACTIVE',
                    retryAfterSec: Math.max(ttl, 1),
                    message: 'Please wait before generating again.',
                };
            }
        }

        const globalCount = parseCount(await client.get(globalDailyKey));
        if (globalCount >= globalDailyLimit) {
            const ttl = await client.ttl(globalDailyKey);
            return {
                allowed: false,
                source: 'redis',
                reason: 'global_daily_limit',
                statusCode: 429,
                errorCode: 'GLOBAL_DAILY_LIMIT_EXCEEDED',
                retryAfterSec: Math.max(ttl, 1),
                message: 'System daily generation limit reached. Please try again later.',
                limit: globalDailyLimit,
            };
        }

        const pipeline = client.pipeline();
        pipeline.incr(globalDailyKey);
        if (globalCount === 0) {
            pipeline.expire(globalDailyKey, dailyTtlSec);
        }

        if (cfg.cooldownSec > 0) {
            pipeline.set(cooldownKey, '1', { ex: cfg.cooldownSec });
        }
        await pipeline.exec();

        return {
            allowed: true,
            source: 'redis',
            generationsToday: globalCount + 1,
            globalGenerationsToday: globalCount + 1,
        };
    }

    function evaluateFinalizeRateLimitMemory(ip) {
        const now = Date.now();
        const finalizeKey = `ratelimit:finalize:${ip}`;

        pruneExpiredMap(memoryState.finalizeCounters, now);
        const counter = getOrInitCounter(memoryState.finalizeCounters, finalizeKey, finalizeWindowSec, now);

        if (counter.count >= finalizeMax) {
            return {
                allowed: false,
                source: 'memory',
                retryAfterSec: retryAfterSec(counter.expiresAt, now),
            };
        }

        counter.count += 1;
        return {
            allowed: true,
            source: 'memory',
        };
    }

    async function evaluateFinalizeRateLimitRedis(client, ip) {
        const finalizeKey = `ratelimit:finalize:${ip}`;
        const current = parseCount(await client.get(finalizeKey));

        if (current >= finalizeMax) {
            const ttl = await client.ttl(finalizeKey);
            return {
                allowed: false,
                source: 'redis',
                retryAfterSec: Math.max(ttl, 1),
            };
        }

        const pipeline = client.pipeline();
        pipeline.incr(finalizeKey);
        if (current === 0) {
            pipeline.expire(finalizeKey, finalizeWindowSec);
        }
        await pipeline.exec();

        return {
            allowed: true,
            source: 'redis',
        };
    }

    return {
        evaluateGenerateRateLimitMemory,
        evaluateGenerateRateLimitRedis,
        evaluateFinalizeRateLimitMemory,
        evaluateFinalizeRateLimitRedis,
    };
}

module.exports = { createRateLimitEvaluators };
