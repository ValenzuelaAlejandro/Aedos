'use strict';
require('./redacted-output');

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Redis } = require('@upstash/redis');
const { createCreditsLedger } = require('../../src/backend/utils/credits-ledger');
const { DAILY_USAGE_UNITS } = require('../../src/backend/config/usage-policy');
const { verifyPreproductionServer } = require('./preproduction-safety');

const REDIS_ACK = 'ISOLATED_PREPRODUCTION_REDIS_ONLY';

async function main() {
    await verifyPreproductionServer();
    const label = String(process.env.AEDOS_REDIS_TEST_LABEL || '');
    if (!/preprod|staging|isolated/i.test(label)) {
        throw new Error('AEDOS_REDIS_TEST_LABEL must identify an isolated preproduction/staging Redis database.');
    }
    if (process.env.AEDOS_REDIS_TEST_ACK !== REDIS_ACK) {
        throw new Error(`Set AEDOS_REDIS_TEST_ACK=${REDIS_ACK} after confirming this is not the live ledger.`);
    }
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.');

    const redis = new Redis({ url, token });
    const ledger = createCreditsLedger({ redis: () => redis, schemaDaily: 2 });
    const ip = `isolated-${crypto.randomUUID()}`;
    const date = new Date();
    const seed = ledger.makeKeys(ip, 'legacy-seed', date);
    await redis.set(seed.legacyBalanceKey, '7', { ex: seed.ttl });
    assert.equal(await ledger.getRemaining(ip, date), 7_000, 'Legacy credits should migrate at 1:1000.');

    const [first, second] = await Promise.all([
        ledger.reserve(ip, 500, `reserve-${crypto.randomUUID()}`, date),
        ledger.reserve(ip, 600, `reserve-${crypto.randomUUID()}`, date),
    ]);
    assert.ok(first.allowed && second.allowed, 'Concurrent reservations should be atomic and both accepted.');
    assert.equal(await ledger.commit(first, 250), true, 'Partial successful usage should settle.');
    assert.equal(await ledger.refund(second), true, 'Failed usage should refund idempotently.');
    assert.equal(await ledger.getRemaining(ip, date), 6_750, 'Only the successful 250 units should remain charged.');
    assert.equal((await ledger.reserve(ip, 1, first.keys.requestKey.split(':').at(-1), date)).allowed, false,
        'A committed idempotency key must not reserve twice.');

    const schemaOne = await ledger.reserveSchemaRequest(ip, `schema-${crypto.randomUUID()}`, date);
    const schemaTwo = await ledger.reserveSchemaRequest(ip, `schema-${crypto.randomUUID()}`, date);
    const schemaThree = await ledger.reserveSchemaRequest(ip, `schema-${crypto.randomUUID()}`, date);
    assert.equal(schemaOne.status, 'allowed');
    assert.equal(schemaTwo.status, 'allowed');
    assert.equal(schemaThree.status, 'limit', 'Schema quota should account for in-flight reservations.');
    assert.equal(await ledger.commitSchemaRequest(schemaOne), true);
    assert.equal(await ledger.refundSchemaRequest(schemaTwo), true);
    assert.equal(Number(await redis.get(schemaOne.keys.legacySchemaKey)), 1,
        'Legacy schema quota should be rollback-compatible.');

    const duplicate = await ledger.reserve(ip, 250, first.keys.requestKey.split(':').at(-1), date);
    assert.equal(duplicate.allowed, false);
    assert.equal((await ledger.reserve(ip, DAILY_USAGE_UNITS, `over-limit-${crypto.randomUUID()}`, date)).allowed, false);
    process.stdout.write(`${JSON.stringify({ result: 'passed', label, migratedUnits: 7_000,
        finalRemainingUnits: await ledger.getRemaining(ip, date), quota: '2 schemas; one committed, one refunded' })}\n`);
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
