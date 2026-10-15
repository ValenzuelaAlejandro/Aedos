'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED_INPUTS, verifyPreproductionServer } = require('../../scripts/prod-checks/preproduction-safety');
const { preproductionAttestation } = require('../../src/backend/utils/preproduction-isolation');

function inputs() {
    return { NODE_ENV: 'preproduction', AEDOS_PREPROD_URL: 'https://aedos-staging.onrender.com',
        AEDOS_PREPROD_VERIFICATION_ACK: 'ISOLATED_PREPRODUCTION_ONLY',
        AEDOS_REDIS_TEST_LABEL: 'staging-isolated-test', AEDOS_LIVE_REDIS_LABEL: 'staging-isolated-test',
        AEDOS_REDIS_TEST_ACK: 'ISOLATED_PREPRODUCTION_REDIS_ONLY',
        AEDOS_LIVE_TEST_ACK: 'ISOLATED_PREPRODUCTION_ONLY',
        GEMINI_API_KEY: 'test-only', AEDOS_GEMINI_429_API_KEY: 'test-only-quota',
        OPENROUTER_API_KEY: 'test-only-router', UPSTASH_REDIS_REST_TOKEN: 'test-only-redis',
        UPSTASH_REDIS_REST_URL: 'https://test-only.upstash.io' };
}

test('each missing preproduction input blocks before any network request', async () => {
    for (const key of REQUIRED_INPUTS) {
        const env = inputs();
        delete env[key];
        let calls = 0;
        await assert.rejects(verifyPreproductionServer(env, async () => { calls += 1; }), /Missing preproduction inputs/);
        assert.equal(calls, 0, key);
    }
});

test('production, unlabelled hosts, bad acknowledgements and ambiguous Redis targets are rejected offline', async () => {
    const variants = [
        { AEDOS_PREPROD_URL: 'https://aedoslab.xyz' },
        { AEDOS_PREPROD_URL: 'https://staging.aedoslab.xyz' },
        { AEDOS_PREPROD_URL: 'https://aedos.onrender.com' },
        { AEDOS_PREPROD_URL: 'https://another-production.example' },
        { AEDOS_PREPROD_URL: 'http://aedos-staging.example' },
        { AEDOS_PREPROD_URL: 'https://aedos-staging.example/path' },
        { AEDOS_PREPROD_VERIFICATION_ACK: 'wrong' },
        { AEDOS_LIVE_TEST_ACK: 'wrong' }, { AEDOS_REDIS_TEST_ACK: 'wrong' },
        { AEDOS_REDIS_TEST_LABEL: 'production' }, { AEDOS_LIVE_REDIS_LABEL: 'staging-other' },
        { UPSTASH_REDIS_REST_URL: 'http://test-only.upstash.io' },
    ];
    for (const variant of variants) {
        let calls = 0;
        await assert.rejects(verifyPreproductionServer({ ...inputs(), ...variant }, async () => { calls += 1; }));
        assert.equal(calls, 0, JSON.stringify(variant));
    }
});

test('a staging hostname alone cannot authorize paid calls or Redis writes against production', async () => {
    const env = inputs();
    assert.equal(preproductionAttestation({ ...env, NODE_ENV: 'production' }), null);
    const proof = preproductionAttestation(env);
    const invalidProofs = [null, { ...proof, environment: 'production' },
        { ...proof, redisLabel: 'staging-other' }, { ...proof, redisFingerprint: 'different-database' }];
    for (const verification of invalidProofs) {
        await assert.rejects(verifyPreproductionServer(env, async (_url, options) => {
            assert.equal(options.redirect, 'error');
            return { ok: true, json: async () => ({ verification }) };
        }), /did not attest/);
    }
    const target = await verifyPreproductionServer(env, async () => ({ ok: true,
        json: async () => ({ status: 'OK', verification: proof }) }));
    assert.equal(target.origin, env.AEDOS_PREPROD_URL);
    assert.doesNotMatch(JSON.stringify(proof), /test-only-redis|test-only-router/);
});
