const test = require('node:test');
const assert = require('node:assert/strict');

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
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

test('Pro pressure returns the frozen 503 response shape', async () => {
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const firstPromise = fetch(`${baseUrl}/generate`, json({ tema: 'Pressure', mode: 'pro', idioma: 'es', slides: 1 }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        const second = await fetch(`${baseUrl}/generate`, json({ tema: 'Pressure', mode: 'pro', idioma: 'es', slides: 1 }));
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
