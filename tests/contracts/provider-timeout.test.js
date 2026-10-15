const test = require('node:test');
const assert = require('node:assert/strict');
const { sseResponse, jsonFrame, installProviderFakes } = require('../helpers/provider-fakes');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'timeout-test-gemini';
process.env.OPENROUTER_API_KEY = 'timeout-test-openrouter';
process.env.AEDOS_TEST_STUB_PROVIDERS = '';
process.env.PROVIDER_ACCEPT_TIMEOUT_MS = '20';
process.env.LIMITS_CHAT_DAILY = '1000';
process.env.LIMITS_OUTLINE_DAILY = '1000';
process.env.LIMITS_FLASH_DAILY = '1000';
process.env.LIMITS_PRO_DAILY = '1000';
const { spendGuard } = require('../../src/backend/utils/spend-guard');
spendGuard.reserveGeminiRequest = async () => true;
spendGuard.reserve = async () => ({ allowed: true });
spendGuard.settle = async () => true;
spendGuard.release = async () => true;

const skeleton = { slides: [{ title: 'Timeout fallback', subtitle: '', points: [] }] };
const openRouterFrame = jsonFrame({ choices: [{ delta: { content: JSON.stringify(skeleton) } }] });

function json(body) {
    return { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'timeout-test-request-0001' }, body: JSON.stringify({
        modelId: 'google/gemini-3-flash-preview', mode: 'flash', conversationId: '86b0f26a-129e-4ca7-9422-4b0ee2af481f',
        ...body
    }) };
}

test('provider acceptance timeout aborts direct request and falls back on the same model', async () => {
    const calls = [];
    const fakes = installProviderFakes({
        gemini: async ({ options }) => new Promise((resolve, reject) => {
            calls.push('gemini');
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
        openrouter: async () => {
            calls.push('openrouter');
            return sseResponse([openRouterFrame, 'data: [DONE]\n\n']);
        }
    });
    const { app } = require('../../src/backend/server');
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/generate-skeleton`, json({ tema: 'Timeout', language: 'es', slides: 1 }));
        assert.equal(response.status, 200);
        assert.match(await response.text(), /"done":true/);
        assert.deepEqual(calls, ['gemini', 'openrouter']);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fakes.restore();
    }
});
