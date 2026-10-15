'use strict';
require('./redacted-output');

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyPreproductionServer } = require('./preproduction-safety');

const PREPROD_ACK = 'ISOLATED_PREPRODUCTION_ONLY';
const expectedProvider = process.env.AEDOS_EXPECT_PROVIDER;

function parseSse(buffer, events) {
    let remainder = buffer;
    let delimiter;
    while ((delimiter = remainder.indexOf('\n\n')) >= 0) {
        const frame = remainder.slice(0, delimiter);
        remainder = remainder.slice(delimiter + 2);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim()).join('\n');
        if (!data) continue;
        try { events.push(JSON.parse(data)); }
        catch (cause) { throw new Error('Preproduction returned an invalid SSE data frame.', { cause }); }
    }
    return remainder;
}

// eslint-disable-next-line complexity -- The guarded CLI keeps target validation, SSE parsing and assertions in one failure-safe run.
async function main() {
    if (process.env.AEDOS_PREPROD_VERIFICATION_ACK !== PREPROD_ACK) {
        throw new Error(`Set AEDOS_PREPROD_VERIFICATION_ACK=${PREPROD_ACK} after confirming this is isolated preproduction.`);
    }
    const target = await verifyPreproductionServer();
    if (!['gemini', 'openrouter'].includes(expectedProvider)) {
        throw new Error('Set AEDOS_EXPECT_PROVIDER to gemini or openrouter for the active key configuration.');
    }

    const requestKey = `preprod-gemini-check-${crypto.randomUUID()}`;
    const body = {
        conversationId: crypto.randomUUID(),
        modelId: 'google/gemini-3-flash-preview',
        mode: 'flash',
        language: 'es',
        slides: 3,
        tema: 'Prueba técnica de preproducción sobre energía solar y almacenamiento.',
    };
    const response = await fetch(new URL('/generate-skeleton', target), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey,
            Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000), redirect: 'error',
    });
    const requestId = response.headers.get('x-request-id');
    if (!response.ok) throw new Error(`Preproduction returned HTTP ${response.status}; requestId=${requestId || 'missing'}.`);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/i,
        'Expected the normal live SSE response.');
    assert.ok(requestId, 'Response must include X-Request-Id for correlation.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let remainder = '';
    let firstContentAt = null;
    const startedAt = Date.now();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        remainder = parseSse(remainder + decoder.decode(value, { stream: true }), events);
        if (firstContentAt === null && events.some(event => typeof event.chunk === 'string' && event.chunk.length > 0)) {
            firstContentAt = Date.now();
        }
        const error = events.find(event => event.error);
        if (error) throw new Error(`Preproduction stream returned an error event; requestId=${requestId}.`);
    }
    if (remainder.trim()) parseSse(`${remainder}\n\n`, events);
    const metadata = events.find(event => event.metadata?.provider)?.metadata;
    const actualProvider = String(metadata?.provider || '').toLowerCase();
    assert.equal(actualProvider, expectedProvider,
        `Expected ${expectedProvider}; got ${actualProvider || 'no provider metadata'}; requestId=${requestId}.`);
    assert.ok(events.some(event => event.done === true), `Missing SSE completion event; requestId=${requestId}.`);
    assert.ok(firstContentAt, `No content arrived in the stream; requestId=${requestId}.`);
    assert.equal(metadata.model, body.modelId, `Selected model changed; requestId=${requestId}.`);

    process.stdout.write(`${JSON.stringify({ result: 'passed', requestId, provider: actualProvider,
        model: metadata.model, contentStreamed: true, elapsedMs: Date.now() - startedAt })}\n`);
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
