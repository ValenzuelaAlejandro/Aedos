const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'contract-test-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
process.env.LIMITS_CHAT_DAILY = '1000';
process.env.LIMITS_OUTLINE_DAILY = '1000';
process.env.LIMITS_FLASH_DAILY = '1000';
process.env.LIMITS_PRO_DAILY = '1000';
process.env.LIMITS_FINALIZE_MAX = '1000';

const { app, sanitizeTema } = require('../../src/backend/server');
const { createCanonicalRedirectMiddleware } = require('../../src/backend/http/middleware/canonical-redirect');
const fixtureDir = path.join(__dirname, '..', 'fixtures', 'contracts');

let server;
let baseUrl;

test.before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(pathname, options = {}) {
    return fetch(`${baseUrl}${pathname}`, options);
}

async function collectSse(response) {
    const text = await response.text();
    return text.split(/\n\n/)
        .map((frame) => frame.trim())
        .filter(Boolean)
        .filter((frame) => frame.startsWith('data: '))
        .map((frame) => JSON.parse(frame.slice(6)));
}

test('canonical redirect leaves API paths on the Render origin', () => {
    const middleware = createCanonicalRedirectMiddleware();
    let continued = false;
    let redirectedTo = null;
    const res = { redirect: (_status, target) => { redirectedTo = target; } };
    const next = () => { continued = true; };

    middleware({ headers: { host: 'aedos.onrender.com' }, path: '/api/credits', originalUrl: '/api/credits' }, res, next);
    assert.equal(continued, true);
    assert.equal(redirectedTo, null);

    middleware({ headers: { host: 'aedos.onrender.com' }, path: '/about', originalUrl: '/about' }, res, next);
    assert.equal(redirectedTo, 'https://aedoslab.xyz/about');
});

function json(body) {
    json.requestId = (json.requestId || 0) + 1;
    return { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `contract-${json.requestId}-request` }, body: JSON.stringify(body) };
}

function multipart(fields, files) {
    multipart.requestId = (multipart.requestId || 0) + 1;
    const form = new FormData();
    const formFields = { ...fields, conversationId: fields.conversationId || randomUUID() };
    for (const [key, value] of Object.entries(formFields)) form.append(key, String(value));
    for (const file of files) form.append('files', new Blob([file.content], { type: file.type || 'application/octet-stream' }), file.name);
    return { method: 'POST', headers: { 'Idempotency-Key': `multipart-${multipart.requestId}-request` }, body: form };
}

test('GET /health and GET / expose the current public entry points', async () => {
    const health = await request('/health');
    assert.equal(health.status, 200);
    const root = await request('/');
    assert.equal(root.status, 200);
    assert.match(await root.text(), /<html/i);
});

test('POST /generate-outline-item returns the current item envelope', async () => {
    const conversationId = randomUUID();
    const start = await request('/generate-skeleton', json({ tema: 'Testing', mode: 'flash', slides: 1,
        modelId: 'google/gemini-3-flash-preview', conversationId }));
    assert.equal(start.status, 200);
    await collectSse(start);
    const response = await request('/generate-outline-item', json({ type: 'slide', topic: 'Testing', mode: 'flash',
        modelId: 'google/gemini-3-flash-preview', conversationId }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['item']);
    assert.equal(body.item.title, 'Test slide');
});

test('POST /generate-skeleton preserves the SSE contract', async () => {
    const response = await request('/generate-skeleton', json({ tema: 'Testing', mode: 'flash', language: 'en', slides: 1,
        modelId: 'google/gemini-3-flash-preview', conversationId: '11111111-1111-4111-8111-111111111111' }));
    assert.equal(response.status, 200);
    const events = await collectSse(response);
    assert.ok(events.some((event) => event.metadata));
    assert.ok(events.some((event) => event.reasoning));
    assert.ok(events.some((event) => event.chunk));
    assert.deepEqual(events.at(-1), { done: true, skeleton: { slide_count: 1, slides: [{ title: 'Test slide', subtitle: 'Test subtitle', role: 'cover', key_points: ['Test point'] }] } });
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'generate-skeleton.events.json'), JSON.stringify(events.map((event) => Object.keys(event).sort()), null, 2) + '\n');
});

test('POST /generate preserves the Flash SSE contract', async () => {
    const response = await request('/generate', json({ tema: 'Testing', mode: 'flash', idioma: 'es', slides: 1,
        modelId: 'google/gemini-3-flash-preview', conversationId: '11111111-1111-4111-8111-111111111111' }));
    assert.equal(response.status, 200);
    const events = await collectSse(response);
    assert.ok(events.some((event) => event.metadata));
    assert.ok(events.some((event) => event.chunk));
    assert.ok(events.some((event) => event.done === true && typeof event.html === 'string'));
    const done = events.find((event) => event.done === true);
    assert.equal(done.requestedModelId, 'google/gemini-3-flash-preview');
    assert.equal(done.effectiveModelId, 'google/gemini-3-flash-preview');
    assert.equal(done.fallbackReason, null);
    fs.mkdirSync(fixtureDir, { recursive: true });
    const legacyEventKeys = events.map((event) => Object.keys(event)
        .filter((key) => !['requestedModelId', 'effectiveModelId', 'fallbackReason'].includes(key)).sort());
    fs.writeFileSync(path.join(fixtureDir, 'generate.events.json'), JSON.stringify(legacyEventKeys, null, 2) + '\n');
});

test('validation responses remain structured', async () => {
    assert.equal(sanitizeTema('x'.repeat(601)).tema.length, 600);
    const conversationId = randomUUID();
    const start = await request('/generate-skeleton', json({ tema: 'Testing', mode: 'flash', slides: 1,
        modelId: 'google/gemini-3-flash-preview', conversationId }));
    assert.equal(start.status, 200);
    await collectSse(start);
    const invalidItem = await request('/generate-outline-item', json({ type: 'unknown', topic: 'Testing',
        mode: 'flash', modelId: 'google/gemini-3-flash-preview', conversationId }));
    assert.equal(invalidItem.status, 400);
    assert.equal((await invalidItem.json()).error, 'Invalid item type');
    const invalidIdioma = await request('/generate', json({ tema: 'Testing', idioma: 'xx', modelId: 'google/gemini-3-flash-preview',
        mode: 'flash', slides: 1, conversationId }));
    assert.equal(invalidIdioma.status, 422);
    assert.deepEqual((await invalidIdioma.json()).fields, { idioma: 'must be one of: auto, es, en, fr, pt, de, it, zh, ja, ru, ar' });
});

test('conversation pins model and mode on the server while allowing output-language changes', async () => {
    const conversationId = randomUUID();
    const first = await request('/generate-skeleton', json({ tema: 'Renewable energy', modelId: 'google/gemini-3-flash-preview',
        mode: 'flash', language: 'en', slides: 1, conversationId }));
    assert.equal(first.status, 200);
    await collectSse(first);

    const changedLanguage = await request('/generate-skeleton', json({ tema: 'Renewable energy', modelId: 'google/gemini-3-flash-preview',
        mode: 'flash', language: 'fr', slides: 1, conversationId }));
    assert.equal(changedLanguage.status, 200);
    await collectSse(changedLanguage);

    const changedMode = await request('/generate-skeleton', json({ tema: 'Renewable energy', modelId: 'google/gemini-3-flash-preview',
        mode: 'pro', language: 'fr', slides: 1, conversationId }));
    assert.equal(changedMode.status, 409);
    assert.equal((await changedMode.json()).code, 'CONVERSATION_CONFIG_MISMATCH');

    const changedModel = await request('/generate', json({ tema: 'Renewable energy', modelId: 'anthropic/claude-haiku-5.5',
        mode: 'flash', language: 'fr', slides: 1, conversationId }));
    assert.equal(changedModel.status, 409);
    assert.equal((await changedModel.json()).code, 'CONVERSATION_CONFIG_MISMATCH');
});

test('finalize validation and missing downloads are reachable without launching Chrome', async () => {
    const pdf = await request('/finalize', json({ title: 'Missing HTML' }));
    assert.notEqual(pdf.status, 200);
    const pptx = await request('/finalize-pptx', json({ title: 'Missing HTML' }));
    assert.notEqual(pptx.status, 200);
    const download = await request('/download/not-a-real-file.pdf');
    assert.equal(download.status, 404);
});

test('download path traversal attempts remain rejected', async () => {
    for (const pathname of ['/download/..%2Fsecret.pdf', '/download/%2e%2e%2fsecret.pdf', '/download/C:%5Csecret.pdf']) {
        const response = await request(pathname);
        assert.ok([400, 404].includes(response.status), `${pathname}: ${response.status}`);
        await response.text();
    }
});

test('multipart accepts one and three supported files', async () => {
    const proConversationId = randomUUID();
    const one = await request('/generate-skeleton', multipart(
        { tema: 'Multipart', mode: 'pro', language: 'en', modelId: 'google/gemini-3-flash-preview', conversationId: proConversationId },
        [{ name: 'notes.txt.pdf', type: 'application/pdf', content: 'fixture' }]
    ));
    assert.equal(one.status, 200);
    assert.equal((await collectSse(one)).at(-1).done, true);

    const three = await request('/generate', multipart(
        { tema: 'Multipart', mode: 'pro', idioma: 'es', slides: 1,
            modelId: 'google/gemini-3-flash-preview', conversationId: proConversationId },
        [
            { name: 'a.pdf', type: 'application/pdf', content: 'a' },
            { name: 'b.doc', type: 'application/msword', content: 'b' },
            { name: 'c.webp', type: 'image/webp', content: 'c' }
        ]
    ));
    assert.equal(three.status, 200, await three.clone().text());
    const proEvents = await collectSse(three);
    assert.ok(proEvents.some((event) => event.stage));
    assert.ok(proEvents.some((event) => event.done === true));
});

test('multipart preserves the supported extension allowlist and filename handling', async () => {
    for (const extension of ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp']) {
        const response = await request('/generate-skeleton', multipart(
            { tema: 'Extension', mode: 'flash', language: 'en' },
            [{ name: `résumé (final)${extension}`, type: 'application/octet-stream', content: 'fixture' }]
        ));
        assert.equal(response.status, 200, extension);
        assert.equal((await collectSse(response)).at(-1).done, true, extension);
    }

    const missingExtension = await request('/generate-skeleton', multipart(
        { tema: 'Extension', mode: 'flash' },
        [{ name: 'no-extension', type: 'application/octet-stream', content: 'fixture' }]
    ));
    assert.equal(missingExtension.status, 400);
    assert.match(missingExtension.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await missingExtension.json(), {
        error: 'Invalid file type. Only PDF, Office Word, and images are allowed.'
    });
});

test('multipart rejects the fourth file and unsupported extensions', async () => {
    const four = await request('/generate-skeleton', multipart(
        { tema: 'Multipart', mode: 'flash' },
        [1, 2, 3, 4].map((index) => ({ name: `file-${index}.pdf`, type: 'application/pdf', content: String(index) }))
    ));
    assert.equal(four.status, 400);
    assert.match(four.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await four.json(), { error: 'Too many files. Maximum is 3.' });

    const unsupported = await request('/generate-skeleton', multipart(
        { tema: 'Multipart', mode: 'flash' },
        [{ name: 'malware.exe', type: 'application/octet-stream', content: 'x' }]
    ));
    assert.equal(unsupported.status, 400);
    assert.match(unsupported.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await unsupported.json(), {
        error: 'Invalid file type. Only PDF, Office Word, and images are allowed.'
    });
});

test('multipart enforces the ten megabyte file limit', async () => {
    const exact = await request('/generate-skeleton', multipart(
        { tema: 'Size', mode: 'flash' },
        [{ name: 'exact.pdf', type: 'application/pdf', content: Buffer.alloc(10 * 1024 * 1024) }]
    ));
    const exactBody = await exact.text();
    assert.equal(exact.status, 413);
    assert.match(exact.headers.get('content-type'), /application\/json/);
    assert.deepEqual(JSON.parse(exactBody), { error: 'File too large. Maximum size is 10 MB.' });

    const over = await request('/generate-skeleton', multipart(
        { tema: 'Size', mode: 'flash' },
        [{ name: 'over.pdf', type: 'application/pdf', content: Buffer.alloc(10 * 1024 * 1024 + 1) }]
    ));
    assert.equal(over.status, 413);
    assert.match(over.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await over.json(), { error: 'File too large. Maximum size is 10 MB.' });
});
