const { getRedis } = require('../utils/rate-limiter');
const { redactSecrets } = require('../utils/redact-secrets');

// A bounded Redis Stream is the durable attempt table; a hash indexes each request.
const STORE_ATTEMPT = `
redis.call('XADD', KEYS[1], 'MAXLEN', '~', 100000, '*', 'row', ARGV[1])
redis.call('HSET', KEYS[2], ARGV[2], ARGV[1])
redis.call('EXPIRE', KEYS[2], 2592000)
return 1`;

/** Persist only allowlisted telemetry; never accept prompts or credentials here. */
async function persistProviderCall(row, redis = getRedis) {
    row = redactSecrets(row);
    if (redis === getRedis && process.env.NODE_ENV === 'test') return true;
    const client = redis();
    if (!client) return false;
    await client.eval(STORE_ATTEMPT,
        ['{aedos-provider-calls}:attempts', `{aedos-provider-calls}:request:${row.requestId || 'unscoped'}`],
        [JSON.stringify(row), row.attemptId]);
    return true;
}

async function persistUsageEvent(row, redis = getRedis) {
    row = redactSecrets(row);
    if (redis === getRedis && process.env.NODE_ENV === 'test') return true;
    const client = redis();
    if (!client) return false;
    await client.eval(STORE_ATTEMPT,
        ['{aedos-provider-calls}:attempts', `{aedos-provider-calls}:request:${row.requestId || 'unscoped'}`],
        [JSON.stringify(row), row.eventId]);
    return true;
}

module.exports = { persistProviderCall, persistUsageEvent };
