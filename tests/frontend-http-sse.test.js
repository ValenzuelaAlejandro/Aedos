const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'tests/fixtures/frontend/sse/reader-cases.json');
const clientPath = path.join(root, 'src/frontend/features/shared/http-sse.js');
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function fixtureChunks(fixture) {
    const bytes = new TextEncoder().encode(fixture.wire);
    if (fixture.splitBytes) return Array.from(bytes, (byte) => Uint8Array.of(byte));
    return [bytes];
}

function createReader(chunks) {
    let index = 0;
    return {
        async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[index++] };
        },
    };
}

// Frozen reference for the two pre-extraction loops in app.js: skeleton uses
// newline-delimited lines; presentation generation uses blank-line blocks and
// explicitly parses the incomplete tail after the reader closes.
async function legacyPayloads(chunks, framing) {
    const decoder = new TextDecoder('utf-8');
    const payloads = { events: [], tail: [] };
    let buffer = '';
    const collect = (line, isTail = false) => {
        let payload;
        if (framing === 'line') {
            if (!line.startsWith('data: ')) return;
            payload = line.slice(6).trim();
            if (!payload) return;
        } else {
            if (line.trim() === '' || !line.startsWith('data: ')) return;
            payload = line.substring(6);
        }
        payloads[isTail ? 'tail' : 'events'].push(payload);
    };

    for (const bytes of chunks) {
        buffer += decoder.decode(bytes, { stream: true });
        if (framing === 'line') {
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) collect(line);
        } else {
            const events = buffer.split('\n\n');
            buffer = events.pop();
            for (const event of events) collect(event);
        }
    }

    if (framing === 'event' && buffer.trim()) {
        for (const line of buffer.split('\n')) collect(line, true);
    }
    return payloads;
}

function loadClient() {
    const window = {};
    const source = fs.readFileSync(clientPath, 'utf8')
        .replace('export function readReader', 'function readReader')
        .replace('export function openResponse', 'function openResponse');
    vm.runInNewContext(source, {
        TextDecoder,
        window,
    }, { filename: clientPath });
    return window.AedosHttpSse;
}

async function sharedPayloads(client, chunks, framing) {
    const response = { body: { getReader: () => createReader(chunks) } };
    const stream = client.openResponse(response, {
        framing,
        flushTail: framing === 'event',
    });
    const payloads = { events: [], tail: [] };
    for await (const item of stream.events) payloads[item.tail ? 'tail' : 'events'].push(item.data);
    return payloads;
}

test('legacy fixtures describe the current two reader implementations', async () => {
    for (const fixture of fixtures) {
        const chunks = fixtureChunks(fixture);
        assert.deepEqual(await legacyPayloads(chunks, 'line'), { events: fixture.line, tail: [] }, `${fixture.name}: line mode`);
        assert.deepEqual(await legacyPayloads(chunks, 'event'), { events: fixture.event, tail: fixture.tail }, `${fixture.name}: event mode`);
    }
});

test('shared HTTP/SSE reader is byte-for-byte equivalent to the legacy fixtures', async () => {
    const client = loadClient();
    assert.ok(client, 'classic script registers window.AedosHttpSse');
    for (const fixture of fixtures) {
        const chunks = fixtureChunks(fixture);
        for (const framing of ['line', 'event']) {
            const legacy = await legacyPayloads(chunks, framing);
            assert.deepEqual(legacy, {
                events: fixture[framing],
                tail: framing === 'event' ? fixture.tail : [],
            }, `${fixture.name}: fixture matches legacy ${framing} behavior`);
            assert.deepEqual(await sharedPayloads(client, chunks, framing), legacy, `${fixture.name}: shared ${framing} behavior`);
        }
    }
});

test('shared reader invokes the read callback once per non-terminal transport chunk', async () => {
    const client = loadClient();
    let readCount = 0;
    const response = { body: { getReader: () => createReader(fixtureChunks(fixtures[1])) } };
    const stream = client.openResponse(response, { framing: 'event', onChunk: () => { readCount += 1; } });
    for await (const payload of stream.events) {
        assert.equal(typeof payload.data, 'string');
    }
    assert.equal(readCount, 1);
});
