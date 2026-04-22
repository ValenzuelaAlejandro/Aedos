/**
 * Upstash Redis-backed rate limiter for Aedos.
 *
 * Replaces express-rate-limit (in-memory) so that:
 *   • Daily counters survive Render cold-starts / sleeps
 *   • Flash and Pro modes have independent limits
 *   • A short cooldown prevents spam bursts
 *
 * Keys used in Redis (per client IP):
 *   ratelimit:daily:{mode}:{ip}   – daily generation count  (TTL 24h)
 *   ratelimit:cooldown:{mode}:{ip} – cooldown flag           (TTL 60s)
 */

const { Redis } = require('@upstash/redis');
const { createLogger, ErrorCategory } = require('./logger');

const log = createLogger({ scope: 'RATE_LIMIT' });

// ── Configuration ────────────────────────────────────────────────────────────
const LIMITS = {
    flash: {
        daily: parseInt(process.env.LIMITS_FLASH_DAILY || '5', 10),
        cooldownSec: parseInt(process.env.LIMITS_FLASH_COOLDOWN_SEC || '60', 10),
    },
    pro: {
        daily: parseInt(process.env.LIMITS_PRO_DAILY || '3', 10),
        cooldownSec: parseInt(process.env.LIMITS_PRO_COOLDOWN_SEC || '60', 10),
    },
};

const DAILY_TTL_SEC = 24 * 60 * 60; // 24 hours
const GLOBAL_DAILY_LIMIT = (() => {
    const parsed = parseInt(process.env.GLOBAL_DAILY_GENERATION_LIMIT || '100', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
})();

const FINALIZE_WINDOW_SEC = 15 * 60; // 15 minutes
const FINALIZE_MAX = 10;

// ── Redis client (lazy singleton) ────────────────────────────────────────────
let redis = null;
let hasWarnedRedisMissing = false;

// ── In-memory fallback state (used when Redis is unavailable) ────────────────
const memoryState = {
    dailyCounters: new Map(),
    cooldowns: new Map(),
    finalizeCounters: new Map(),
};

// ── IP audit state (helps verify real-client IP behavior in production) ─────
const IP_AUDIT_WINDOW_MS = 15 * 60 * 1000;
const IP_AUDIT_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const IP_AUDIT_SINGLE_IP_MIN_SAMPLES = 30;
const IP_AUDIT_SINGLE_IP_WARNING_INTERVAL_MS = 2 * 60 * 1000;

const ipAuditState = {
    recentIps: new Map(),
    sampleCount: 0,
    lastSnapshotAt: 0,
    lastSingleIpWarningAt: 0,
};

function getRedis() {
    if (redis) return redis;

    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        if (!hasWarnedRedisMissing) {
            hasWarnedRedisMissing = true;
            log.warn(ErrorCategory.CONFIG,
                'UPSTASH_REDIS_REST_URL or TOKEN missing - using in-memory limiter fallback');
        }
        return null;
    }

    hasWarnedRedisMissing = false;
    redis = new Redis({ url, token });
    return redis;
}

/**
 * Verify that the Upstash connection is alive.
 * Called once at startup — logs success/failure but never throws.
 */
async function verifyConnection() {
    const client = getRedis();
    if (!client) return false;

    try {
        const pong = await client.ping();
        log.success(ErrorCategory.CONFIG, 'Upstash Redis connection verified', { pong });
        return true;
    } catch (err) {
        log.error(ErrorCategory.NETWORK,
            'Upstash Redis connection FAILED — rate limiting will be disabled', {
                error: err.message || err,
            });
        redis = null;               // force re-creation on next attempt
        return false;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveClientIp(req) {
    // trust proxy is already set to 1 in server.js
    const ip = req.ip ||
        req.headers['cf-connecting-ip'] ||
        req.headers['x-real-ip'] ||
        parseForwardedFor(req.headers['x-forwarded-for']) ||
        req.socket?.remoteAddress ||
        'unknown';

    return normalizeIp(ip);
}

function normalizeMode(body) {
    return body?.mode === 'pro' ? 'pro' : 'flash';
}

function parseForwardedFor(value) {
    if (!value) return null;
    const first = String(value).split(',')[0].trim();
    return first || null;
}

function normalizeIp(value) {
    if (!value) return 'unknown';
    const ip = String(value).trim();
    if (!ip) return 'unknown';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

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

function auditResolvedIp(req, ip) {
    const now = Date.now();
    ipAuditState.recentIps.set(ip, now);
    ipAuditState.sampleCount += 1;

    for (const [trackedIp, lastSeen] of ipAuditState.recentIps.entries()) {
        if (now - lastSeen > IP_AUDIT_WINDOW_MS) {
            ipAuditState.recentIps.delete(trackedIp);
        }
    }

    if (now - ipAuditState.lastSnapshotAt >= IP_AUDIT_SNAPSHOT_INTERVAL_MS) {
        ipAuditState.lastSnapshotAt = now;
        log.info(ErrorCategory.SECURITY, 'IP audit snapshot', {
            sampleCount: ipAuditState.sampleCount,
            uniqueIpsInWindow: ipAuditState.recentIps.size,
            windowMinutes: Math.floor(IP_AUDIT_WINDOW_MS / 60000),
            forwardedForPresent: Boolean(req.headers['x-forwarded-for']),
            trustProxy: req.app?.get('trust proxy') || null,
        });
    }

    if (
        process.env.NODE_ENV === 'production' &&
        ipAuditState.sampleCount >= IP_AUDIT_SINGLE_IP_MIN_SAMPLES &&
        ipAuditState.recentIps.size <= 1 &&
        now - ipAuditState.lastSingleIpWarningAt >= IP_AUDIT_SINGLE_IP_WARNING_INTERVAL_MS
    ) {
        ipAuditState.lastSingleIpWarningAt = now;
        const singleIp = [...ipAuditState.recentIps.keys()][0] || ip;
        log.warn(ErrorCategory.SECURITY, 'IP diversity alert: requests resolving to a single IP', {
            sampleCount: ipAuditState.sampleCount,
            uniqueIpsInWindow: ipAuditState.recentIps.size,
            detectedIp: singleIp,
            recommendation: 'Verify proxy/IP forwarding headers in production',
        });
    }
}

function deny(res, statusCode, errorCode, retryAfter, message) {
    return res.status(statusCode).json({
        error: errorCode,
        retryAfterSec: Math.max(retryAfter || 1, 1),
        message,
    });
}

function evaluateGenerateRateLimitMemory(ip, mode, cfg) {
    const now = Date.now();
    const globalDailyKey = 'ratelimit:daily:global';
    const dailyKey = `ratelimit:daily:${mode}:${ip}`;
    const cooldownKey = `ratelimit:cooldown:${mode}:${ip}`;

    pruneExpiredMap(memoryState.cooldowns, now);
    pruneExpiredMap(memoryState.dailyCounters, now);

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

    const globalCounter = getOrInitCounter(memoryState.dailyCounters, globalDailyKey, DAILY_TTL_SEC, now);
    if (globalCounter.count >= GLOBAL_DAILY_LIMIT) {
        return {
            allowed: false,
            source: 'memory',
            reason: 'global_daily_limit',
            statusCode: 429,
            errorCode: 'GLOBAL_DAILY_LIMIT_EXCEEDED',
            retryAfterSec: retryAfterSec(globalCounter.expiresAt, now),
            message: 'System daily generation limit reached. Please try again later.',
            limit: GLOBAL_DAILY_LIMIT,
        };
    }

    const dailyCounter = getOrInitCounter(memoryState.dailyCounters, dailyKey, DAILY_TTL_SEC, now);
    if (dailyCounter.count >= cfg.daily) {
        return {
            allowed: false,
            source: 'memory',
            reason: 'daily_limit',
            statusCode: 429,
            errorCode: mode === 'pro' ? 'DAILY_LIMIT_EXCEEDED_PRO' : 'DAILY_LIMIT_EXCEEDED_FLASH',
            retryAfterSec: retryAfterSec(dailyCounter.expiresAt, now),
            message: 'Daily limit reached for this mode.',
            limit: cfg.daily,
        };
    }

    dailyCounter.count += 1;
    globalCounter.count += 1;
    memoryState.cooldowns.set(cooldownKey, now + cfg.cooldownSec * 1000);

    return {
        allowed: true,
        source: 'memory',
        generationsToday: dailyCounter.count,
        globalGenerationsToday: globalCounter.count,
    };
}

async function evaluateGenerateRateLimitRedis(client, ip, mode, cfg) {
    const globalDailyKey = 'ratelimit:daily:global';
    const dailyKey = `ratelimit:daily:${mode}:${ip}`;
    const cooldownKey = `ratelimit:cooldown:${mode}:${ip}`;

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

    const globalCount = parseCount(await client.get(globalDailyKey));
    if (globalCount >= GLOBAL_DAILY_LIMIT) {
        const ttl = await client.ttl(globalDailyKey);
        return {
            allowed: false,
            source: 'redis',
            reason: 'global_daily_limit',
            statusCode: 429,
            errorCode: 'GLOBAL_DAILY_LIMIT_EXCEEDED',
            retryAfterSec: Math.max(ttl, 1),
            message: 'System daily generation limit reached. Please try again later.',
            limit: GLOBAL_DAILY_LIMIT,
        };
    }

    const currentCount = parseCount(await client.get(dailyKey));
    if (currentCount >= cfg.daily) {
        const ttl = await client.ttl(dailyKey);
        return {
            allowed: false,
            source: 'redis',
            reason: 'daily_limit',
            statusCode: 429,
            errorCode: mode === 'pro' ? 'DAILY_LIMIT_EXCEEDED_PRO' : 'DAILY_LIMIT_EXCEEDED_FLASH',
            retryAfterSec: Math.max(ttl, 1),
            message: 'Daily limit reached for this mode.',
            limit: cfg.daily,
        };
    }

    const pipeline = client.pipeline();
    pipeline.incr(dailyKey);
    if (currentCount === 0) {
        pipeline.expire(dailyKey, DAILY_TTL_SEC);
    }

    pipeline.incr(globalDailyKey);
    if (globalCount === 0) {
        pipeline.expire(globalDailyKey, DAILY_TTL_SEC);
    }

    pipeline.set(cooldownKey, '1', { ex: cfg.cooldownSec });
    await pipeline.exec();

    return {
        allowed: true,
        source: 'redis',
        generationsToday: currentCount + 1,
        globalGenerationsToday: globalCount + 1,
    };
}

function evaluateFinalizeRateLimitMemory(ip) {
    const now = Date.now();
    const finalizeKey = `ratelimit:finalize:${ip}`;

    pruneExpiredMap(memoryState.finalizeCounters, now);
    const counter = getOrInitCounter(memoryState.finalizeCounters, finalizeKey, FINALIZE_WINDOW_SEC, now);

    if (counter.count >= FINALIZE_MAX) {
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

    if (current >= FINALIZE_MAX) {
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
        pipeline.expire(finalizeKey, FINALIZE_WINDOW_SEC);
    }
    await pipeline.exec();

    return {
        allowed: true,
        source: 'redis',
    };
}

// ── Express middleware ───────────────────────────────────────────────────────

/**
 * Middleware that checks daily limit + cooldown BEFORE the generation runs.
 *
 * On success it also:
 *   • increments the daily counter (with 24 h TTL)
 *   • sets the cooldown flag  (with 60 s TTL)
 *
 * If Upstash is unreachable we fail-open (allow the request).
 */
function checkRateLimits(req, res, next) {
    const client = getRedis();
    const ip   = resolveClientIp(req);
    const mode = normalizeMode(req.body);
    const cfg  = LIMITS[mode];
    auditResolvedIp(req, ip);

    // We run the check async but still inside Express middleware
    (async () => {
        let decision;

        try {
            if (client) {
                decision = await evaluateGenerateRateLimitRedis(client, ip, mode, cfg);
            } else {
                decision = evaluateGenerateRateLimitMemory(ip, mode, cfg);
            }
        } catch (err) {
            log.error(ErrorCategory.NETWORK,
                'Redis error during rate-limit check - using in-memory fallback', {
                    ip, mode, error: err.message || err,
                });

            decision = evaluateGenerateRateLimitMemory(ip, mode, cfg);
            decision.source = 'memory-fallback';
        }

        if (!decision.allowed) {
            log.warn(ErrorCategory.SECURITY, 'Generation request blocked by limiter', {
                ip,
                mode,
                source: decision.source,
                reason: decision.reason,
                retryAfterSec: decision.retryAfterSec,
                limit: decision.limit,
            });

            return deny(
                res,
                decision.statusCode,
                decision.errorCode,
                decision.retryAfterSec,
                decision.message
            );
        }

        log.info(ErrorCategory.SECURITY, 'Rate limit check passed', {
            ip,
            mode,
            source: decision.source,
            generationsToday: decision.generationsToday,
            dailyLimit: cfg.daily,
            cooldownSec: cfg.cooldownSec,
            globalGenerationsToday: decision.globalGenerationsToday,
            globalDailyLimit: GLOBAL_DAILY_LIMIT,
        });

        next();
    })();
}

/**
 * Middleware for the /finalize endpoint (PDF generation).
 * Separate lighter limit: 10 per 15 min window.
 */
function checkFinalizeLimits(req, res, next) {
    const client = getRedis();
    const ip = resolveClientIp(req);

    (async () => {
        let decision;

        try {
            if (client) {
                decision = await evaluateFinalizeRateLimitRedis(client, ip);
            } else {
                decision = evaluateFinalizeRateLimitMemory(ip);
            }
        } catch (err) {
            log.error(ErrorCategory.NETWORK,
                'Redis error during finalize rate-limit - using in-memory fallback', {
                    ip, error: err.message || err,
                });

            decision = evaluateFinalizeRateLimitMemory(ip);
            decision.source = 'memory-fallback';
        }

        if (!decision.allowed) {
            log.warn(ErrorCategory.SECURITY, 'Finalize request blocked by limiter', {
                ip,
                source: decision.source,
                retryAfterSec: decision.retryAfterSec,
                limit: FINALIZE_MAX,
            });

            return res.status(429).json({
                error: 'RATE_LIMIT_EXCEEDED',
                retryAfterSec: decision.retryAfterSec,
            });
        }

        next();
    })();
}

module.exports = {
    verifyConnection,
    checkRateLimits,
    checkFinalizeLimits,
    LIMITS,
};
