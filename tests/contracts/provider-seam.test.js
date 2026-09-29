const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'provider-seam-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
process.env.LIMITS_CHAT_DAILY = '1000';
process.env.LIMITS_OUTLINE_DAILY = '1000';
process.env.LIMITS_FLASH_DAILY = '1000';
process.env.LIMITS_PRO_DAILY = '1000';

const { app, setTestProviderOverride, clearTestProviderOverride } = require('../../src/backend/server');

function json(body) {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

test.after(() => clearTestProviderOverride());

test('test-only provider seam can return a deterministic fallback-shaped response', async () => {
    const calls = [];
    setTestProviderOverride(({ stageName, openrouterModels }) => {
        calls.push({ stageName, openrouterModels });
        return {
            provider: 'openrouter',
            model: 'test/fallback',
            stream: (async function* () {
                yield JSON.stringify({ title: 'Injected item', role: 'concept', key_points: [] });
            })(),
        };
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/generate-outline-item`, json({ type: 'slide', topic: 'Injected' }));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { item: { title: 'Injected item', role: 'concept', key_points: [] } });
        assert.equal(calls[0].stageName, 'Stage1');
        assert.ok(Array.isArray(calls[0].openrouterModels));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('test provider seam is rejected outside test mode', () => {
    process.env.NODE_ENV = 'production';
    assert.throws(() => setTestProviderOverride(() => null), /only available in test mode/);
    process.env.NODE_ENV = 'test';
});
