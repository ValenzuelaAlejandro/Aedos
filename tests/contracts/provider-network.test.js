const test = require('node:test');
const assert = require('node:assert/strict');
const { sseResponse, jsonFrame, installProviderFakes } = require('../helpers/provider-fakes');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'network-test-gemini';
process.env.OPENROUTER_API_KEY = 'network-test-openrouter';
process.env.AEDOS_TEST_STUB_PROVIDERS = '';
process.env.LIMITS_CHAT_DAILY = '1000';
process.env.LIMITS_OUTLINE_DAILY = '1000';
process.env.LIMITS_FLASH_DAILY = '1000';
process.env.LIMITS_PRO_DAILY = '1000';

const skeleton = { slides: [{ title: 'Fallback slide', subtitle: '', points: [] }] };
const skeletonFrame = jsonFrame({ candidates: [{ content: { parts: [{ text: JSON.stringify(skeleton) }] } }] });
const openRouterFrame = jsonFrame({ choices: [{ delta: { content: JSON.stringify(skeleton) } }] });

function json(body) {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function readSse(response) {
    return await response.text();
}

function events(raw) {
    return raw.trim().split('\n\n').map((block) => JSON.parse(block.replace(/^data: /, '')));
}

test('Gemini acceptance failure falls back to OpenRouter with the frozen SSE sequence', async () => {
    const calls = [];
    const fakes = installProviderFakes({
        gemini: async () => {
            calls.push('gemini');
            return new Response('unavailable', { status: 503 });
        },
        openrouter: async () => {
            calls.push('openrouter');
            return sseResponse([openRouterFrame, jsonFrame('[DONE]')]);
        },
        genai: { GoogleGenAI: class FakeGoogleGenAI {} }
    });
    const { app } = require('../../src/backend/server');
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/generate-skeleton`, json({ tema: 'Fallback', language: 'es' }));
        const raw = await readSse(response);
        assert.equal(response.status, 200);
        assert.deepEqual(calls, ['gemini', 'gemini', 'openrouter']);
        assert.deepEqual(events(raw), [
            { metadata: { provider: 'openrouter', model: 'google/gemini-2.5-flash-lite' } },
            { chunk: JSON.stringify(skeleton) },
            { done: true, skeleton }
        ]);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fakes.restore();
    }
});

test('Gemini stream failure after content preserves the exact terminal SSE error', async () => {
    const fakes = installProviderFakes({
        gemini: async () => sseResponse([
            skeletonFrame,
            { delayMs: 20, error: new Error('GEMINI_STREAM_INTERRUPTED') }
        ]),
        openrouter: async () => {
            throw new Error('OpenRouter must not be reached after acceptance');
        }
    });
    const { app } = require('../../src/backend/server');
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/generate-skeleton`, json({ tema: 'Midstream', language: 'es' }));
        assert.equal(response.status, 200);
        assert.deepEqual(events(await readSse(response)), [
            { metadata: { provider: 'gemini', model: 'gemini-2.5-flash-lite' } },
            { chunk: JSON.stringify(skeleton) },
            { error: 'Failed to generate outline. Please try again.' }
        ]);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fakes.restore();
    }
});

test('Gemini and every OpenRouter model failure preserve the final error shape', async () => {
    const fakes = installProviderFakes({
        gemini: async () => new Response('unavailable', { status: 503 }),
        openrouter: async () => new Response('quota', { status: 429 })
    });
    const { app } = require('../../src/backend/server');
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/generate-skeleton`, json({ tema: 'Double failure', language: 'es' }));
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: 'Failed to generate outline. Please try again.' });
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fakes.restore();
    }
});
