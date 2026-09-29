const test = require('node:test');
const assert = require('node:assert/strict');
const { SSE_HEADERS, formatSseEvent, writeSse, setSseHeaders } = require('../../src/backend/contracts/sse');

test('SSE formatter preserves the captured wire bytes', () => {
    assert.equal(formatSseEvent({ metadata: { provider: 'stub', model: 'test' } }), 'data: {"metadata":{"provider":"stub","model":"test"}}\n\n');
    assert.equal(formatSseEvent({ done: true, skeleton: { slide_count: 1 } }), 'data: {"done":true,"skeleton":{"slide_count":1}}\n\n');
});

test('SSE helpers preserve headers and write order', () => {
    const headers = {};
    const writes = [];
    const response = { setHeader: (name, value) => { headers[name] = value; }, flushHeaders: () => {}, write: (value) => writes.push(value) };
    setSseHeaders(response);
    writeSse(response, { chunk: 'hello' });
    assert.deepEqual(headers, SSE_HEADERS);
    assert.deepEqual(writes, ['data: {"chunk":"hello"}\n\n']);
});
