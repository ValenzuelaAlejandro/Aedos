'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('rehearsal blocks external fetch, raw TCP and HTTPS before connecting', () => {
    const probe = spawnSync(process.execPath, ['--require', './scripts/prod-checks/rehearsal-network.js', '-e', `
        const assert = require('node:assert/strict');
        (async () => {
            await assert.rejects(fetch('https://example.com'), /EXTERNAL_NETWORK_BLOCKED/);
            await assert.rejects(fetch('https://openrouter.ai/api/v1/chat/completions'), /EXTERNAL_NETWORK_BLOCKED/);
            assert.throws(() => require('node:net').connect({host:'8.8.8.8',port:443}), /EXTERNAL_NETWORK_BLOCKED/);
            assert.throws(() => require('node:https').get('https://example.com'), /EXTERNAL_NETWORK_BLOCKED/);
            assert.throws(() => require('node:http').get('http://example.com'), /EXTERNAL_NETWORK_BLOCKED/);
            const server = require('node:http').createServer((req,res) => {
                res.writeHead(302,{Location:'https://example.com'});res.end();
            });
            await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
            try { await assert.rejects(fetch('http://127.0.0.1:'+server.address().port), /fetch failed/); }
            finally { server.closeAllConnections(); server.close(); }
        })().catch(() => { process.exitCode = 1; });
    `], { env: { ...process.env, AEDOS_REHEARSAL_TRANSPORT: '' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(probe.status, 0, probe.stderr);
});
