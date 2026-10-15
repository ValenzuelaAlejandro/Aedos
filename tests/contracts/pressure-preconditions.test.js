const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'pressure-test-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
process.env.LIMITS_CHAT_DAILY = '1000';
process.env.LIMITS_OUTLINE_DAILY = '1000';
process.env.LIMITS_FLASH_DAILY = '1000';
process.env.LIMITS_PRO_DAILY = '1000';
process.env.MAX_CONCURRENT_GENERATIONS = '1';
process.env.PRO_PAUSE_ACTIVE_GENERATIONS = '1';
process.env.PRO_PAUSE_QUEUE_DEPTH = '40';

const { app } = require('../../src/backend/server');

function json(body) {
    json.requestId = (json.requestId || 0) + 1;
    return { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `pressure-${json.requestId}-request` }, body: JSON.stringify(body) };
}

test('Pro pressure returns the frozen 503 response shape', async () => {
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const conversationId = randomUUID();
    try {
        const seed = await fetch(`${baseUrl}/generate-skeleton`, json({ tema: 'Pressure', mode: 'pro', idioma: 'es', slides: 1,
            modelId: 'google/gemini-3-flash-preview', conversationId }));
        assert.equal(seed.status, 200);
        await seed.text();
        const body = { tema: 'Pressure', mode: 'pro', idioma: 'es', slides: 1,
            modelId: 'google/gemini-3-flash-preview', conversationId };
        const firstPromise = fetch(`${baseUrl}/generate`, json(body));
        await new Promise((resolve) => setTimeout(resolve, 50));
        const second = await fetch(`${baseUrl}/generate`, json(body));
        assert.equal(second.status, 503);
        assert.deepEqual(await second.json(), {
            error: 'PRO_TEMPORARILY_PAUSED',
            retryAfterSec: 30,
            message: 'Pro mode is temporarily paused due to high system load. Please retry shortly or use Flash mode.',
        });
        await (await firstPromise).text();
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
