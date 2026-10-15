'use strict';

const { isolatedLabel, validatePreproductionTarget, redisFingerprint } = require('../../src/backend/utils/preproduction-isolation');
const REQUIRED_INPUTS = Object.freeze([
    'AEDOS_PREPROD_URL', 'AEDOS_PREPROD_VERIFICATION_ACK', 'AEDOS_REDIS_TEST_LABEL',
    'AEDOS_REDIS_TEST_ACK', 'AEDOS_LIVE_REDIS_LABEL', 'AEDOS_LIVE_TEST_ACK',
    'GEMINI_API_KEY', 'AEDOS_GEMINI_429_API_KEY', 'OPENROUTER_API_KEY',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
]);

function validatePreproductionInputs(env = process.env) {
    const missing = REQUIRED_INPUTS.filter(key => !env[key]?.trim());
    if (missing.length) throw new Error(`Missing preproduction inputs: ${missing.join(', ')}`);
    if (env.AEDOS_PREPROD_VERIFICATION_ACK !== 'ISOLATED_PREPRODUCTION_ONLY'
        || env.AEDOS_LIVE_TEST_ACK !== 'ISOLATED_PREPRODUCTION_ONLY'
        || env.AEDOS_REDIS_TEST_ACK !== 'ISOLATED_PREPRODUCTION_REDIS_ONLY') {
        throw new Error('Incorrect isolation acknowledgement; no checks were started.');
    }
    if (!isolatedLabel(env.AEDOS_REDIS_TEST_LABEL)
        || env.AEDOS_LIVE_REDIS_LABEL !== env.AEDOS_REDIS_TEST_LABEL) {
        throw new Error('Redis labels must match and identify one isolated staging/preprod database.');
    }
    redisFingerprint(env.UPSTASH_REDIS_REST_URL);
    return validatePreproductionTarget(env.AEDOS_PREPROD_URL);
}

async function verifyPreproductionServer(env = process.env, fetchImpl = global.fetch) {
    // Validate EVERY input before even the read-only attestation request.
    const target = validatePreproductionInputs(env);
    const response = await fetchImpl(new URL('/health', target), {
        redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Preproduction attestation failed; no provider or Redis checks were started.');
    const proof = (await response.json()).verification;
    if (proof?.schema !== 'aedos-preproduction-v1' || proof.environment !== 'preproduction'
        || proof.redisLabel !== env.AEDOS_REDIS_TEST_LABEL
        || proof.redisFingerprint !== redisFingerprint(env.UPSTASH_REDIS_REST_URL)) {
        throw new Error('Server did not attest isolated preproduction with the expected Redis; paid calls and Redis writes are blocked.');
    }
    return target;
}

module.exports = { REQUIRED_INPUTS, validatePreproductionInputs, verifyPreproductionServer };
