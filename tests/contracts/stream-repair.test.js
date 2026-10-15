'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { consumeModelStream } = require('../../src/backend/pipeline/stream');

class FakeResponse extends EventEmitter {
    constructor() { super(); this.writes = []; this.writableEnded = false; this.destroyed = false; }
    write(chunk) { this.writes.push(chunk); return true; }
}

function parseEvents(response) {
    return response.writes.filter(chunk => chunk.startsWith('data: '))
        .map(chunk => JSON.parse(chunk.slice(6).trim()));
}

test('repair stream forwards only slide fragments after replaying accepted HTML', async () => {
    const response = new FakeResponse();
    const baselineHtml = '<html><head><style>section.s{color:red}</style></head><body><section class="s"><h1>Accepted</h1></section>';
    const html = '<!doctype html><html><head><style>new rules</style></head><body>'
        + '<section class="s"><h1>Repaired'
        + ' slide</h1></section></body></html>';
    const stream = { provider: 'openrouter', model: 'model', stream: (async function * chunks() {
        yield { type: 'reset', stage: 'repair', attempt: 1 };
        yield { text: html.slice(0, 65) };
        yield { text: html.slice(65, 122) };
        yield { text: html.slice(122) };
    }()) };

    const result = await consumeModelStream({
        log: { warn() {} }, ErrorCategory: { STREAM: 'stream', VALIDATION: 'validation' }
    }, stream, response, 'repair-stream-test', () => false, 3, { baselineHtml });

    const events = parseEvents(response);
    const streamedChunks = events.filter(event => event.chunk && !event.replay).map(event => event.chunk).join('');
    assert.equal(result.repairHtml, html);
    assert.equal(events.find(event => event.replay).chunk, baselineHtml);
    assert.match(streamedChunks, /^<section class="s"><h1>Repaired slide<\/h1><\/section>$/);
    assert.doesNotMatch(streamedChunks, /doctype|<html|<head|<body|<style|new rules|<\/body>/i);
});
