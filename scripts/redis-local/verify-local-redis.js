'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { RespClient } = require('./resp-client');
const { createCreditsLedger } = require('../../src/backend/utils/credits-ledger');
const { createSpendGuard, utcKeys } = require('../../src/backend/utils/spend-guard');
const { providerRequestContext } = require('../../src/backend/providers/request-context');
const { createSelectedModelRouter } = require('../../src/backend/providers/model-selection');
const { persistProviderCall } = require('../../src/backend/providers/telemetry-store');

const MODEL_ID = 'google/gemini-3-flash-preview';
const REDIS_BIN = process.env.AEDOS_REDIS_SERVER_BIN || path.resolve(__dirname,
    '../../node_modules/.cache/redis-memory-server/redis-binaries/stable/memurai.exe');

async function freePort() {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not reserve a local Redis test port.');
    const { port } = address;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)));
    return port;
}

function quoteConfigPath(filePath) { return `"${filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }

function createServerConfig(directory, port, password) {
    fs.mkdirSync(directory, { recursive: true });
    const aclFile = path.join(directory, 'users.acl');
    const configFile = path.join(directory, 'redis.conf');
    fs.writeFileSync(aclFile,
        `user default off\nuser aedos-test on >${password} ~* &* +@all\n`);
    fs.writeFileSync(configFile, [
        'bind 127.0.0.1',
        `port ${port}`,
        'protected-mode yes',
        'daemonize no',
        `dir ${quoteConfigPath(directory)}`,
        'dbfilename dump.rdb',
        'save 1 1',
        'appendonly no',
        `aclfile ${quoteConfigPath(aclFile)}`,
        'loglevel warning',
        ''
    ].join('\n'));
    return configFile;
}

async function startServer(configFile, port, username, password) {
    const child = spawn(REDIS_BIN, [configFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk.toString(); });
    child.stderr.on('data', chunk => { logs += chunk.toString(); });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Redis server exited early: ${logs}`);
        try {
            const client = await RespClient.connect({ port, username, password, timeoutMs: 1000 });
            if (await client.command('PING') === 'PONG') return { child, client, logs: () => logs };
            client.close();
        } catch (_) { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    child.kill();
    throw new Error(`Redis server did not become ready: ${logs}`);
}

async function stopServer(server) {
    const exited = once(server.child, 'exit');
    try { await server.client.command('SHUTDOWN', 'SAVE'); } catch (_) { /* SHUTDOWN closes its own client socket. */ }
    server.client.close();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (server.child.exitCode === null) server.child.kill();
    if (server.child.exitCode === null) await once(server.child, 'exit');
}

function objectFromHash(reply) {
    const result = {};
    for (let index = 0; index < reply.length; index += 2) result[reply[index]] = reply[index + 1];
    return result;
}

async function testCreditsAndSpend(client) {
    const date = new Date('2026-10-14T12:00:00Z');
    const ledger = createCreditsLedger({ redis: () => client, now: () => date, schemaDaily: 3 });
    const ip = `local-redis-${crypto.randomUUID()}`;
    const migrationKeys = ledger.makeKeys(ip, 'migration', date);
    await client.set(migrationKeys.legacyBalanceKey, '7', { ex: migrationKeys.ttl });
    assert.equal(await ledger.getRemaining(ip, date), 7_000, 'Legacy credits migrate at the 1:1000 scale.');

    const requestA = `concurrent-a-${crypto.randomUUID()}`;
    const requestB = `concurrent-b-${crypto.randomUUID()}`;
    const concurrent = await Promise.all([
        ledger.reserve(ip, 4_000, requestA, date),
        ledger.reserve(ip, 4_000, requestB, date),
    ]);
    assert.equal(concurrent.filter(item => item.allowed).length, 1, 'Only one 4,000-unit reservation fits in 7,000 units.');
    assert.equal(concurrent.filter(item => item.code === 'INSUFFICIENT_USAGE').length, 1);
    assert.equal(await ledger.getRemaining(ip, date), 3_000);
    const successful = concurrent.find(item => item.allowed);
    assert.equal(await ledger.commit(successful, 2_500), true, 'Successful use settles at actual delivered units.');
    assert.equal(await ledger.getRemaining(ip, date), 4_500);
    assert.equal((await ledger.reserve(ip, 1, successful.keys.requestKey.split(':').at(-1), date)).allowed, false,
        'A committed request ID cannot reserve twice.');

    const refundable = await ledger.reserve(ip, 1_000, `refund-${crypto.randomUUID()}`, date);
    assert.equal(refundable.allowed, true);
    assert.equal(await ledger.refund(refundable), true);
    const afterFirstRefund = await ledger.getRemaining(ip, date);
    assert.equal(await ledger.refund(refundable), true, 'A repeated refund is idempotently acknowledged.');
    assert.equal(await ledger.getRemaining(ip, date), afterFirstRefund, 'A replayed refund cannot credit the balance twice.');
    assert.equal(await ledger.getRemaining(ip, date), 4_500);

    const schemaKeys = ledger.makeKeys(ip, 'legacy-schema', date);
    await client.set(schemaKeys.legacySchemaKey, '1', { ex: schemaKeys.ttl });
    const schemaA = await ledger.reserveSchemaRequest(ip, `schema-a-${crypto.randomUUID()}`, date);
    const schemaB = await ledger.reserveSchemaRequest(ip, `schema-b-${crypto.randomUUID()}`, date);
    const schemaC = await ledger.reserveSchemaRequest(ip, `schema-c-${crypto.randomUUID()}`, date);
    assert.equal(schemaA.status, 'allowed');
    assert.equal(schemaB.status, 'allowed');
    assert.equal(schemaC.status, 'limit', 'Legacy schema use plus pending requests respects its quota.');
    assert.equal(await ledger.commitSchemaRequest(schemaA), true);
    assert.equal(await ledger.refundSchemaRequest(schemaB), true);
    assert.equal(Number(await client.get(schemaA.keys.legacySchemaKey)), 2);

    const spendEnv = { PAID_SPEND_DAILY_USD: '1', PAID_SPEND_MONTHLY_USD: '10',
        PAID_SPEND_PER_IP_DAILY_USD: '0.20', AI_SPEND_MAX_REQUEST_USD: '0.20' };
    const guard = createSpendGuard({ redis: () => client, env: spendEnv, now: () => date });
    const state = { reservedMicroUsd: 0, settledMicroUsd: 0, attemptCount: 0,
        startedAt: Date.now(), clientIp: ip };
    await providerRequestContext.run({ requestId: `spend-${crypto.randomUUID()}`, clientIp: ip, spendState: state }, async () => {
        const reservation = await guard.reserve(0.10, { provider: 'openrouter', model: 'test-model' });
        assert.equal(reservation.allowed, true, 'USD must be reserved before the provider call.');
        assert.equal(reservation.amount, 125_000, 'A 1.25 margin is held before the call.');
        assert.equal(await guard.settle(reservation, 0.08), true);
        assert.equal(await guard.settle(reservation, 0.08), true, 'Settlement replay cannot debit the request state twice.');
    });
    const keys = utcKeys(date);
    assert.equal(Number(await client.get(keys[0])), 80_000);
    const status = await guard.getSpendStatus();
    assert.equal(status.dailyUsd, 1);
    assert.equal(status.perIpDailyUsd, 0.20);
    return { ledger, ip, date };
}

async function testNoDoubleDebitOnStreamRetry(client, ledger, ip, date) {
    const requestId = `retry-${crypto.randomUUID()}`;
    const reservation = await ledger.reserve(ip, 1_000, requestId, date);
    const warnings = [];
    let openRouterCalls = 0;
    const router = createSelectedModelRouter({
        gemini: async () => ({ provider: 'gemini', model: MODEL_ID, stream: (async function* () {
            yield 'discard this partial';
            throw new Error('GEMINI_HTTP_429');
        })() }),
        openrouter: async (_prompt, _stage, models) => {
            openRouterCalls += 1;
            assert.deepEqual(models, [MODEL_ID], 'Fallback keeps the selected model.');
            return { provider: 'openrouter', model: MODEL_ID, stream: (async function* () { yield 'complete response'; })() };
        },
        getOverride: () => null,
        createStub: () => { throw new Error('test stub was not expected'); },
        providerLog: { warn(_category, _message, fields) { warnings.push(fields); } },
        ErrorCategory: { PROVIDER: 'PROVIDER' },
        sleep: async () => {},
        shouldUseTestStub: () => false,
    });
    await providerRequestContext.run({ requestId, req: { body: { modelId: MODEL_ID, mode: 'chat' } } }, async () => {
        const result = await router.makeCaller('Stage1', 'gemini-3-flash-preview', [])('prompt', null,
            { selectedModel: { id: MODEL_ID } });
        let draft = '';
        for await (const item of result.stream) {
            if (item?.type === 'reset') draft = '';
            else if (typeof item === 'string') draft += item;
        }
        assert.equal(draft, 'complete response', 'The failed attempt is discarded before retry content.');
    });
    assert.equal(openRouterCalls, 1);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].requestId, requestId, 'Retry diagnostics share the request ID.');
    assert.equal(await ledger.commit(reservation, 500), true);
    assert.equal((await ledger.reserve(ip, 1, requestId, date)).allowed, false, 'Fallback is charged once.');
}

async function testSpendOverage(client, date) {
    const requestId = `overage-${crypto.randomUUID()}`;
    const guard = createSpendGuard({ redis: () => client, now: () => date, env: {} });
    await providerRequestContext.run({ requestId, clientIp: `overage-ip-${crypto.randomUUID()}` }, async () => {
        const reservation = await guard.reserve(0.01, { requestId, provider: 'openrouter', model: MODEL_ID });
        assert.equal(reservation.amount, 12_500);
        assert.equal(await guard.settle(reservation, 0.02), true);
        assert.equal(await guard.settle(reservation, 0.02), true, 'Replayed excess cannot alert/debit twice.');
        assert.equal((await guard.reserve(0.001)).reason, 'GLOBAL_SPEND_LIMIT');
    });
    const rows = await client.command('XRANGE', '{aedos-spend}:overages', '-', '+');
    const row = rows.map(entry => objectFromHash(entry[1])).find(entry => entry.requestId === requestId);
    assert.equal(row.overageMicroUsd, '7500');
    assert.equal(row.alert, 'critical');
    assert.equal(row.action, 'paid_requests_paused');
    assert.equal((await guard.getSpendStatus()).spendPaused, true);
    return requestId;
}

async function main() {
    if (!fs.existsSync(REDIS_BIN)) throw new Error(`Redis server not found at ${REDIS_BIN}; run npm run redis:setup first.`);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aedos-local-redis-'));
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()))) throw new Error('Refusing to clean a Redis test folder outside the temporary directory.');
    const data = path.join(root, 'data');
    const port = await freePort();
    const password = crypto.randomBytes(24).toString('hex');
    const config = createServerConfig(data, port, password);
    let server;
    try {
        server = await startServer(config, port, 'aedos-test', password);
        assert.equal(await server.client.command('ACL', 'WHOAMI'), 'aedos-test');
        assert.match(await server.client.command('INFO', 'persistence'), /rdb_last_bgsave_status:ok/);
        const unauthenticated = await RespClient.connect({ port });
        await assert.rejects(unauthenticated.command('PING'), /NOAUTH|Authentication required/i);
        unauthenticated.close();

        const { ledger, ip, date } = await testCreditsAndSpend(server.client);
        await testNoDoubleDebitOnStreamRetry(server.client, ledger, ip, date);
        const overageRequestId = await testSpendOverage(server.client, date);

        const telemetryRow = { event: 'provider_call', requestId: `persist-${crypto.randomUUID()}`,
            attemptId: crypto.randomUUID(), provider: 'gemini', model: MODEL_ID, fallbackReason: 'rate_limited' };
        assert.equal(await persistProviderCall(telemetryRow, () => server.client), true);
        const oldPort = port;
        await stopServer(server);
        server = null;
        const restarted = await startServer(config, oldPort, 'aedos-test', password);
        server = restarted;
        assert.equal(await server.client.command('ACL', 'WHOAMI'), 'aedos-test');
        const telemetryHash = await server.client.command('HGETALL',
            `{aedos-provider-calls}:request:${telemetryRow.requestId}`);
        if (!telemetryHash.length) throw new Error(`Telemetry index did not survive restart: ${JSON.stringify({ telemetryRow, logs: server.logs().slice(-2000) })}`);
        const stored = objectFromHash(telemetryHash);
        assert.equal(JSON.parse(stored[telemetryRow.attemptId]).requestId, telemetryRow.requestId,
            'Correlated provider telemetry survives the Redis restart.');
        assert.equal(JSON.parse(stored[telemetryRow.attemptId]).fallbackReason, 'rate_limited');
        assert.equal(await server.client.get('{aedos-spend}:paused'), '1', 'Preventive pause survives restart.');
        const overages = await server.client.command('XRANGE', '{aedos-spend}:overages', '-', '+');
        assert.ok(overages.some(entry => objectFromHash(entry[1]).requestId === overageRequestId),
            'The critical excess event survives restart.');
        process.stdout.write(`${JSON.stringify({ result: 'passed', redis: 'Memurai Redis 8.2 local isolated',
            acl: 'default off; named ACL user authenticated', persistence: 'RDB snapshot survived restart',
            checks: ['legacy migration 1:1000', 'atomic concurrency', 'partial settlement', 'idempotent refund',
                'schema quota migration', 'single debit after same-model stream retry', 'correlated telemetry after restart',
                'real Lua overage records critical event and persists preventive pause after restart'] })}\n`);
    } finally {
        if (server) await stopServer(server).catch(() => {});
        fs.rmSync(root, { recursive: true, force: true });
    }
}

module.exports = { freePort, createServerConfig, startServer, stopServer };
if (require.main === module) main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
