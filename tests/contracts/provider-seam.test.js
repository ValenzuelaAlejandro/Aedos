const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'provider-seam-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
process.env.LIMITS_CHAT_DAILY = '1000';
process.env.LIMITS_OUTLINE_DAILY = '1000';
process.env.LIMITS_FLASH_DAILY = '1000';
process.env.LIMITS_PRO_DAILY = '1000';

const { app, setTestProviderOverride, clearTestProviderOverride } = require('../../src/backend/server');

function json(body) {
    json.requestId = (json.requestId || 0) + 1;
    return { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `provider-${json.requestId}-request` }, body: JSON.stringify(body) };
}

test.after(() => clearTestProviderOverride());

test('test-only provider seam can return a deterministic fallback-shaped response', async () => {
    const calls = [];
    setTestProviderOverride(({ stageName, openrouterModels, options }) => {
        calls.push({ stageName, openrouterModels, expectedOutput: options.expectedOutput });
        const output = options.expectedOutput === 'outline-item'
            ? JSON.stringify({ title: 'Injected item', role: 'concept', key_points: [] })
            : JSON.stringify({ slides: [{ title: 'Seed slide', key_points: ['Seed point'] }] });
        return {
            provider: 'openrouter',
            model: 'test/fallback',
            stream: (async function* () {
                yield output;
            })(),
        };
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const conversationId = randomUUID();
        const origin = `http://127.0.0.1:${server.address().port}`;
        const start = await fetch(`${origin}/generate-skeleton`, json({ tema: 'Injected', conversationId,
            modelId: 'google/gemini-3-flash-preview', mode: 'flash', slides: 1 }));
        assert.equal(start.status, 200);
        await start.text();
        const response = await fetch(`${origin}/generate-outline-item`, json({ type: 'slide', topic: 'Injected', conversationId,
            modelId: 'google/gemini-3-flash-preview', mode: 'flash' }));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { item: { title: 'Injected item', role: 'concept', key_points: [] } });
        assert.equal(calls.at(-1).stageName, 'Stage1');
        assert.equal(calls.at(-1).expectedOutput, 'outline-item');
        assert.ok(Array.isArray(calls.at(-1).openrouterModels));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('test provider seam is rejected outside test mode', () => {
    process.env.NODE_ENV = 'production';
    assert.throws(() => setTestProviderOverride(() => null), /only available in test mode/);
    process.env.NODE_ENV = 'test';
});
