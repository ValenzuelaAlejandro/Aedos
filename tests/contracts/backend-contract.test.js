const test = require('node:test');
const assert = require('node:assert/strict');
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

function json(body) {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

test('GET /health and GET / expose the current public entry points', async () => {
    const health = await request('/health');
    assert.equal(health.status, 200);
    const root = await request('/');
    assert.equal(root.status, 200);
    assert.match(await root.text(), /<html/i);
});

test('POST /generate-outline-item returns the current item envelope', async () => {
    const response = await request('/generate-outline-item', json({ type: 'slide', topic: 'Testing' }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['item']);
    assert.equal(body.item.title, 'Test slide');
});

test('POST /generate-skeleton preserves the SSE contract', async () => {
    const response = await request('/generate-skeleton', json({ tema: 'Testing', mode: 'flash', language: 'en' }));
    assert.equal(response.status, 200);
    const events = await collectSse(response);
    assert.ok(events.some((event) => event.metadata));
    assert.ok(events.some((event) => event.reasoning));
    assert.ok(events.some((event) => event.chunk));
    assert.deepEqual(events.at(-1), { done: true, skeleton: { slide_count: 1, slides: [{ title: 'Test slide', subtitle: 'Test subtitle', role: 'concept', key_points: ['Test point'] }] } });
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'generate-skeleton.events.json'), JSON.stringify(events.map((event) => Object.keys(event).sort()), null, 2) + '\n');
});

test('POST /generate preserves the Flash SSE contract', async () => {
    const response = await request('/generate', json({ tema: 'Testing', mode: 'flash', idioma: 'es', slides: 1 }));
    assert.equal(response.status, 200);
    const events = await collectSse(response);
    assert.ok(events.some((event) => event.metadata));
    assert.ok(events.some((event) => event.chunk));
    assert.ok(events.some((event) => event.done === true && typeof event.html === 'string'));
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'generate.events.json'), JSON.stringify(events.map((event) => Object.keys(event).sort()), null, 2) + '\n');
});

test('validation responses remain structured', async () => {
    assert.equal(sanitizeTema('x'.repeat(601)).tema.length, 600);

    const invalidItem = await request('/generate-outline-item', json({ type: 'unknown', topic: 'Testing' }));
    assert.equal(invalidItem.status, 400);
    assert.equal((await invalidItem.json()).error, 'Invalid item type');

    const invalidIdioma = await request('/generate', json({ tema: 'Testing', idioma: 'ja' }));
    assert.equal(invalidIdioma.status, 422);
    assert.deepEqual((await invalidIdioma.json()).fields, { idioma: 'must be one of: es, en, fr, pt, de' });
});

test('finalize validation and missing downloads are reachable without launching Chrome', async () => {
    const pdf = await request('/finalize', json({ title: 'Missing HTML' }));
    assert.notEqual(pdf.status, 200);
    const pptx = await request('/finalize-pptx', json({ title: 'Missing HTML' }));
    assert.notEqual(pptx.status, 200);
    const download = await request('/download/not-a-real-file.pdf');
    assert.equal(download.status, 404);
});
