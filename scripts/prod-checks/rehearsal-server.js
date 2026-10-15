'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { freePort, createServerConfig, startServer, stopServer } = require('../redis-local/verify-local-redis');
let redis, transport, application, directory;
let fault = 'valid';

async function redisReply(command) {
    try { return { result: await redis.client.command(...command) }; }
    catch (_) { return { error: 'REHEARSAL_REDIS_COMMAND_FAILED' }; }
}

function providerReply(req, res, body, url) {
    const gemini = url.pathname === '/gemini';
    const scenario = url.searchParams.get('key')?.includes('invalid-test-suffix') ? 'http'
        : url.searchParams.get('key') === 'rehearsal-low-quota' ? '429' : fault;
    if (scenario === 'unavailable' || (gemini && ['http', '429'].includes(scenario))) {
        res.writeHead(scenario === '429' ? 429 : scenario === 'http' ? 400 : 503); return res.end('{}');
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (gemini && scenario === 'safety') {
        frame({ candidates: [{ finishReason: 'SAFETY' }] }); return res.end();
    }
    if (gemini && scenario === 'empty') {
        frame({ candidates: [{ finishReason: 'STOP' }] }); return res.end();
    }
    const skeleton = { title: 'Energía solar', slides: Array.from({ length: 3 }, (_, index) => ({
        title: `Energía solar ${index + 1}`, role: 'concept', key_points: ['Energía renovable', 'Almacenamiento eficiente'],
    })) };
    const text = gemini ? JSON.stringify(skeleton) : 'Complete response from the same selected model.';
    if (gemini) {
        frame({ candidates: [{ content: { parts: [{ text }] } }] });
        frame({ candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 80 } });
    } else {
        frame({ model: body.model, choices: [{ delta: { content: text } }] });
        frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 80, cost: 0.000025 } });
        res.write('data: [DONE]\n\n');
    }
    res.end();
}

async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === '/fault') { fault = body.fault; res.end('{}'); return; }
    if (url.pathname.startsWith('/redis')) {
        const pipeline = url.pathname.endsWith('/pipeline');
        const result = pipeline ? await Promise.all(body.map(redisReply)) : await redisReply(body);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
    }
    providerReply(req, res, body, url);
}

async function main() {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aedos-rehearsal-'));
    const port = await freePort();
    const config = createServerConfig(directory, port, crypto.randomBytes(24).toString('hex'));
    const password = fs.readFileSync(path.join(directory, 'users.acl'), 'utf8').match(/>(\w+)/)[1];
    redis = await startServer(config, port, 'aedos-test', password);
    transport = http.createServer((req, res) => handle(req, res).catch(() => { res.writeHead(500); res.end('{}'); }));
    transport.listen(0, '127.0.0.1'); await once(transport, 'listening');
    process.env.AEDOS_REHEARSAL_TRANSPORT = `http://127.0.0.1:${transport.address().port}`;
    require('./rehearsal-network');
    require('dotenv').config = () => ({ parsed: {} });
    const { app } = require('../../src/backend/server');
    application = app.listen(0, '127.0.0.1'); await once(application, 'listening');
    process.send({ transport: process.env.AEDOS_REHEARSAL_TRANSPORT, target: `http://127.0.0.1:${application.address().port}` });
}

async function close() {
    application?.closeAllConnections(); application?.close();
    transport?.closeAllConnections(); transport?.close();
    if (redis) await stopServer(redis);
    if (directory && path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
    process.exit();
}
process.on('message', message => { if (message === 'close') close(); });
process.on('disconnect', close);
main().catch(() => { process.stderr.write('Rehearsal fixture startup failed.\n'); process.exitCode = 1; close(); });
