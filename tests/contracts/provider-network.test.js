const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { sseResponse, jsonFrame, installProviderFakes } = require('../helpers/provider-fakes');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'network-test-gemini';
process.env.OPENROUTER_API_KEY = 'network-test-openrouter';
process.env.AEDOS_TEST_STUB_PROVIDERS = '';
process.env.LIMITS_CHAT_DAILY = '1000';
process.env.LIMITS_OUTLINE_DAILY = '1000';
process.env.LIMITS_FLASH_DAILY = '1000';
process.env.LIMITS_PRO_DAILY = '1000';
// Provider-network tests exercise the HTTP/SSE seam; the Redis guard has its own
// atomicity tests and is mocked here so no external account or Redis is used.
const { spendGuard } = require('../../src/backend/utils/spend-guard');
spendGuard.reserveGeminiRequest = async () => true;
spendGuard.reserve = async () => ({ allowed: true });
spendGuard.settle = async () => true;
spendGuard.release = async () => true;

const skeleton = { slides: [{ title: 'Fallback slide', subtitle: '', points: [] }] };
const skeletonFrame = jsonFrame({ candidates: [{ content: { parts: [{ text: JSON.stringify(skeleton) }] } }] });
const openRouterFrame = jsonFrame({ choices: [{ delta: { content: JSON.stringify(skeleton) }, finish_reason: 'stop' }] });

function json(body) {
    json.requestId = (json.requestId || 0) + 1;
    const payload = { modelId: 'google/gemini-3-flash-preview', mode: 'flash', slides: 1,
        conversationId: randomUUID(), ...body };
    return { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `provider-network-${json.requestId}` }, body: JSON.stringify(payload) };
}

async function createConversation(url, options = {}) {
    const conversationId = randomUUID();
    const response = await fetch(`${url}/generate-skeleton`, json({ tema: 'Fallback conversation', ...options, conversationId }));
    assert.equal(response.status, 200, await response.clone().text());
    await readSse(response);
    return conversationId;
}

async function readSse(response) {
    return await response.text();
}

function events(raw) {
    return raw.trim().split('\n\n').map((block) => JSON.parse(block.replace(/^data: /, '')));
}

test('Gemini acceptance failure uses same-model OpenRouter fallback without visible errors', async () => {
    const calls = [];
    const fakes = installProviderFakes({
        gemini: async () => {
            calls.push('gemini');
            return new Response('unavailable', { status: 503 });
        },
        openrouter: async () => {
            calls.push('openrouter');
            return sseResponse([openRouterFrame, 'data: [DONE]\n\n']);
        },
        genai: { GoogleGenAI: class FakeGoogleGenAI {} }
    });
    const { app } = require('../../src/backend/server');
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/generate-skeleton`, json({ tema: 'Fallback', language: 'es', slides: 1 }));
        const raw = await readSse(response);
        assert.equal(response.status, 200);
        assert.deepEqual(calls, ['gemini', 'openrouter']);
        assert.ok(events(raw).some(event => event.done));
        assert.ok(events(raw).every(event => !event.error));
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fakes.restore();
    }
});

test('Gemini stream failure discards its partial content and delivers only fallback content', async () => {
    const fakes = installProviderFakes({
        gemini: async () => sseResponse([
            skeletonFrame,
            { delayMs: 20, error: new Error('GEMINI_STREAM_INTERRUPTED') }
        ]),
        openrouter: async () => {
            return sseResponse([openRouterFrame, 'data: [DONE]\n\n']);
        }
    });
    const { app } = require('../../src/backend/server');
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/generate-skeleton`, json({ tema: 'Midstream', language: 'es', slides: 1 }));
        assert.equal(response.status, 200);
        const received = events(await readSse(response));
        const reset = received.findIndex(event => event.reset);
        assert.ok(received.slice(0, reset).some(event => event.chunk));
        assert.ok(received.slice(reset).some(event => event.metadata?.provider === 'openrouter'));
        assert.deepEqual(received.at(-1), { done: true, skeleton });
        let visible = '';
        for (const event of received) { if (event.reset) visible = ''; if (event.chunk) visible += event.chunk; }
        assert.equal(visible, JSON.stringify(skeleton));
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
        const response = await fetch(`http://127.0.0.1:${server.address().port}/generate-skeleton`, json({ tema: 'Double failure', language: 'es', slides: 1 }));
        assert.equal(response.status, 200);
        assert.deepEqual(events(await response.text()).find(event => event.error), {
            error: 'The AI providers are temporarily unavailable. Please try again later.',
            code: 'PROVIDER_UNAVAILABLE'
        });
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fakes.restore();
    }
});

test('chat fallback commits one credit and failed retries refund the same reservation', async () => {
    let failAll = false;
    const fakes = installProviderFakes({
        gemini: async () => new Response('', { status: 429 }),
        openrouter: async () => failAll ? new Response('', { status: 500 }) : sseResponse([openRouterFrame, 'data: [DONE]\n\n'])
    });
    const { app } = require('../../src/backend/server');
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const balance = async () => (await (await fetch(`${url}/api/usage`)).json()).remainingUnits;
    try {
        const conversationId = await createConversation(url, { currentSkeleton: skeleton });
        const before = await balance();
        const options = id => ({ ...json({ tema: 'Revise this outline', currentSkeleton: skeleton, slides: 1, conversationId }),
            headers: { ...json({}).headers, 'Idempotency-Key': id } });
        const response = await fetch(`${url}/generate-skeleton`, options('fallback-chat-one-charge'));
        assert.match(await response.text(), /"done":true/);
        const afterSuccess = await balance();
        assert.ok(afterSuccess < before && before - afterSuccess < 1000, 'fallback settles one token-based charge, not two');
        const replay = await fetch(`${url}/generate-skeleton`, options('fallback-chat-one-charge'));
        assert.equal(replay.status, 409);
        assert.equal(await balance(), afterSuccess);
        failAll = true;
        const failed = await fetch(`${url}/generate-skeleton`, options('fallback-chat-refund'));
        assert.equal(failed.status, 200);
        assert.ok(events(await failed.text()).some(event => event.error));
        assert.equal(await balance(), afterSuccess);
    } finally { await new Promise(resolve => server.close(resolve)); fakes.restore(); }
});

test('presentation fallback discards partial HTML and commits the presentation charge only once', async () => {
    const html = '<html><head><style>section.s{width:1280px;height:720px}</style></head><body><section class="s"><h1>Complete deck</h1></section></body></html>';
    const models = [];
    const fakes = installProviderFakes({
        gemini: async () => sseResponse([jsonFrame({ candidates: [{ content: { parts: [{ text: '<html>DISCARD_PARTIAL' }] } }] }),
            { delayMs: 1, error: new Error('GEMINI_STREAM_INTERRUPTED') }]),
        openrouter: async ({ options }) => {
            models.push(JSON.parse(options.body).model);
            return sseResponse([jsonFrame({ choices: [{ delta: { content: html }, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']);
        }
    });
    const { app } = require('../../src/backend/server');
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const balance = async () => (await (await fetch(`${url}/api/usage`)).json()).remainingUnits;
    try {
        const conversationId = await createConversation(url, { modelId: 'google/gemini-3-flash-preview', mode: 'flash' });
        models.length = 0;
        const before = await balance();
        const response = await fetch(`${url}/generate`, {
            ...json({ tema: 'Complete solar energy deck', slides: 1, mode: 'flash', modelId: 'google/gemini-3-flash-preview', conversationId }),
            headers: { 'content-type': 'application/json', 'Idempotency-Key': 'fallback-deck-one-charge' }
        });
        const raw = await response.text();
        assert.equal(response.status, 200);
        assert.ok(raw.includes('DISCARD_PARTIAL'));
        let visible = '';
        for (const event of events(raw)) { if (event.reset) visible = ''; if (event.chunk) visible += event.chunk; }
        assert.ok(!visible.includes('DISCARD_PARTIAL'));
        assert.match(visible, /Complete deck/);
        assert.ok(events(raw).every(event => !event.error));
        const done = events(raw).find(event => event.done);
        assert.match(done.html, /Complete deck/);
        assert.equal(done.effectiveModelId, 'google/gemini-3-flash-preview');
        assert.deepEqual(models, ['google/gemini-3-flash-preview']);
        assert.equal(await balance(), before - 1600); // One Gemini Flash slide is 3.2% of the daily allowance.
    } finally { await new Promise(resolve => server.close(resolve)); fakes.restore(); }
});
