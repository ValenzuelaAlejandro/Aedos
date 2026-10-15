const test = require('node:test');
const assert = require('node:assert/strict');
const { providerRequestContext } = require('../../src/backend/providers/request-context');
const { recordProviderCall } = require('../../src/backend/providers/telemetry');
const { persistProviderCall } = require('../../src/backend/providers/telemetry-store');

test('concurrent provider logs retain HTTP correlation and exclude user data', async () => {
    const rows = [];
    const run = (requestId, mode) => providerRequestContext.run({ requestId, req: { body: { mode, modelId: 'selected' } } },
        async () => {
            await new Promise(resolve => setTimeout(resolve, requestId === 'first' ? 10 : 1));
            return recordProviderCall({ provider: 'gemini', model: 'selected', fallbackReason: 'timeout',
                prompt: 'private prompt', apiKey: 'private secret' }, async row => { rows.push(row); return true; });
        });
    await Promise.all([run('first', 'pro'), run('second', 'flash')]);
    assert.equal(rows.find(row => row.requestId === 'first').mode, 'pro');
    assert.equal(rows.find(row => row.requestId === 'second').mode, 'flash');
    assert.notEqual(rows[0].attemptId, rows[1].attemptId);
    assert.equal(rows[0].fallback, true);
    assert.equal(rows[0].requestedModelId, 'selected');
    assert.ok(!JSON.stringify(rows).includes('private'));
});

test('attempt table and per-request index are persisted atomically', async () => {
    let call;
    const row = { requestId: 'correlated', attemptId: 'attempt' };
    assert.equal(await persistProviderCall(row, () => ({ async eval(...args) { call = args; } })), true);
    assert.match(call[0], /XADD/);
    assert.match(call[0], /HSET/);
    assert.deepEqual(call[1], ['{aedos-provider-calls}:attempts', '{aedos-provider-calls}:request:correlated']);
    assert.deepEqual(JSON.parse(call[2][0]), row);
});

test('telemetry storage failure does not discard a completed provider response', async () => {
    const row = await recordProviderCall({ provider: 'gemini' }, async () => { throw new Error('storage offline'); });
    assert.equal(row.provider, 'gemini');
});
