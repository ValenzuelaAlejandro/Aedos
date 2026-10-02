const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'queue-test-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
process.env.LIMITS_CHAT_DAILY = '1000';
process.env.LIMITS_OUTLINE_DAILY = '1000';
process.env.LIMITS_FLASH_DAILY = '1000';
process.env.LIMITS_PRO_DAILY = '1000';
process.env.MAX_CONCURRENT_GENERATIONS = '1';
process.env.MAX_QUEUE_DEPTH = '1';
process.env.PRO_PAUSE_ACTIVE_GENERATIONS = '99';
process.env.PRO_PAUSE_QUEUE_DEPTH = '99';

const { app, setTestProviderOverride, clearTestProviderOverride } = require('../../src/backend/server');

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function rawPost(agent, port, topic) {
    const responseReady = deferred();
    const responseEnded = deferred();
    const events = [];
    let eventListener;
    const request = http.request({
        host: '127.0.0.1',
        port,
        path: '/generate',
        method: 'POST',
        agent,
        headers: { 'content-type': 'application/json' },
    }, (response) => {
        responseReady.resolve(response.statusCode);
        let pending = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
            pending += chunk;
            const blocks = pending.split('\n\n');
            pending = blocks.pop();
            for (const block of blocks) {
                const line = block.split('\n').find((item) => item.startsWith('data: '));
                if (!line) continue;
                const event = JSON.parse(line.slice(6));
                events.push(event);
                eventListener?.(event);
            }
        });
        response.on('end', () => responseEnded.resolve(pending));
    });
    request.on('error', (error) => {
        responseReady.resolve({ error });
        responseEnded.resolve();
    });
    request.end(JSON.stringify({ tema: topic, idioma: 'es', slides: 1, mode: 'flash' }));
    return {
        request,
        events,
        responseReady: responseReady.promise,
        responseEnded: responseEnded.promise,
        waitForEvent(predicate, timeoutMs = 1500) {
            const existing = events.find(predicate);
            if (existing) return Promise.resolve(existing);
            return Promise.race([
                new Promise((resolve) => {
                    eventListener = (event) => { if (predicate(event)) resolve(event); };
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for SSE event')), timeoutMs)),
            ]);
        },
        destroy() { request.destroy(); },
    };
}

function waitForStart(starts, index, timeoutMs = 1500) {
    if (starts[index]) return Promise.resolve();
    return Promise.race([
        new Promise((resolve) => { starts[index] = resolve; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Provider ${index + 1} did not start`)), timeoutMs)),
    ]);
}

test('queued generation survives request close, enforces capacity, resumes in order and removes real disconnects', async () => {
    const providerGates = [deferred(), deferred(), deferred()];
    const providerStarts = [];
    const startSignals = [];
    setTestProviderOverride(async () => {
        const index = providerStarts.length;
        providerStarts.push(index);
        startSignals[index]?.();
        await providerGates[index].promise;
        return {
            provider: 'test',
            model: `blocked-${index + 1}`,
            stream: (async function* () {
                yield '<!-- CONFIG test --><html><head><style>section.s{width:1280px;height:720px}</style></head><body><section class="s"><h1>Queue test</h1></section></body></html>';
            })(),
        };
    });

    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
    const port = server.address().port;
    let first;
    let second;
    let third;
    let fourth;
    let fifth;
    try {
        first = rawPost(agent, port, 'first');
        await waitForStart(startSignals, 0);
        second = rawPost(agent, port, 'second');
        await second.waitForEvent((event) => event.queued === true);
        assert.equal(second.request.socket.destroyed, false);
        third = rawPost(agent, port, 'third');
        assert.equal(await third.responseReady, 429);
        const thirdBody = await third.responseEnded;
        assert.deepEqual(JSON.parse(thirdBody), {
            error: 'QUEUE_FULL',
            retryAfterSec: 30,
            message: 'The generation queue is full. Please try again in a few seconds.',
        });

        providerGates[0].resolve();
        await waitForStart(startSignals, 1);
        fourth = rawPost(agent, port, 'disconnecting');
        await fourth.waitForEvent((event) => event.queued === true);
        fourth.destroy();
        await new Promise((resolve) => setTimeout(resolve, 50));
        fifth = rawPost(agent, port, 'fifth');
        await fifth.waitForEvent((event) => event.queued === true);
        const thirdProviderStarted = waitForStart(startSignals, 2);
        providerGates[1].resolve();
        await thirdProviderStarted;
        providerGates[2].resolve();
        await Promise.all([first.responseEnded, second.responseEnded, fifth.responseEnded]);
        assert.deepEqual(providerStarts, [0, 1, 2]);
    } finally {
        first?.destroy();
        second?.destroy();
        third?.destroy();
        fourth?.destroy();
        fifth?.destroy();
        providerGates.forEach((gate) => gate.resolve());
        agent.destroy();
        await new Promise((resolve) => server.close(resolve));
        server.closeAllConnections?.();
        clearTestProviderOverride();
    }
});
