'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { redactSecrets } = require('../../src/backend/utils/redact-secrets');

test('logs and telemetry redact nested credentials, error URLs and active secret values, retaining token counts', async () => {
    const key = 'canary-secret-do-not-persist-928346';
    const old = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = key;
    try {
        const result = redactSecrets({ token: key, error: new Error(`https://example.invalid/?key=${key}`),
            nested: [{ Authorization: `Bearer ${key}`, requestId: key }], prompt_tokens: 90 });
        assert.ok(!JSON.stringify(result).includes(key));
        assert.equal(result.prompt_tokens, 90);
        const { recordProviderCall } = require('../../src/backend/providers/telemetry');
        let persisted;
        const row = await recordProviderCall({ provider: key, model: key, errorCode: key, prompt_tokens: 90 }, async value => { persisted = value; return true; });
        assert.ok(!JSON.stringify([row, persisted]).includes(key));
        const { persistProviderCall, persistUsageEvent } = require('../../src/backend/providers/telemetry-store');
        const writes = [];
        const redis = () => ({ eval(...args) { writes.push(args); return Promise.resolve(1); } });
        await persistProviderCall({ requestId: key, attemptId: 'attempt', nested: { token: key } }, redis);
        await persistUsageEvent({ requestId: key, eventId: 'usage', error: new Error(key) }, redis);
        assert.ok(!JSON.stringify(writes).includes(key));
        const probe = spawnSync(process.execPath, ['--require', './scripts/prod-checks/redacted-output.js', '-e',
            'console.log(process.env.GEMINI_API_KEY); console.error(new Error("?key="+process.env.GEMINI_API_KEY));'],
        { env: { ...process.env, GEMINI_API_KEY: key }, encoding: 'utf8' });
        assert.equal(probe.status, 0);
        assert.ok(!(probe.stdout + probe.stderr).includes(key));
    } finally { if (old === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = old; }
});

test('local credential file is ignored and no browser asset or committed evidence contains active secrets', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const ignored = spawnSync('git', ['check-ignore', '.env.preprod'], { encoding: 'utf8' });
    assert.equal(ignored.status, 0);
    function walk(directory) {
        return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const file = path.join(directory, entry.name);
            return entry.isDirectory() ? walk(file) : [file];
        });
    }
    const secrets = Object.entries(process.env).filter(([name, value]) => /API_KEY|REST_TOKEN/.test(name) && value?.length >= 12).map(([, value]) => value);
    for (const file of [...walk('src/frontend'), ...walk('docs/evidence')]) {
        const contents = fs.readFileSync(file);
        for (const secret of secrets) assert.ok(!contents.includes(Buffer.from(secret)), `Secret found in ${file}`);
    }
});
