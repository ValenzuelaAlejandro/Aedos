const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(fetch, overrides = {}) {
    const timers = new Map();
    const window = { fetch, setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id), ...overrides };
    vm.runInNewContext(fs.readFileSync('src/frontend/features/credits/credits-service.js', 'utf8'), { window });
    return { service: window.AedosCredits, timers };
}

test('credits become ready while models are still pending; model failure cannot invalidate balance', async () => {
    let releaseModels;
    const models = new Promise(resolve => { releaseModels = resolve; });
    const states = [];
    const { service } = load(async url => url === '/api/usage'
        ? { ok: true, json: async () => ({ dailyUnits: 50_000, remainingUnits: 25_000 }) } : models);
    const refresh = service.createRefresher({ onCredits: credits => states.push(credits.balance),
        onSuccess: credits => credits, onUnavailable: () => assert.fail('balance invalidated') });
    const pending = refresh();
    assert.equal(refresh(), pending);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(states, [25_000]);
    releaseModels({ ok: false, status: 503 });
    assert.equal((await pending).balance, 25_000);
});

test('invalid credit payload is unavailable rather than a fabricated usable balance', async () => {
    const { service } = load(async () => ({ ok: true, json: async () => ({ daily: 50, remaining: '50' }) }));
    await assert.rejects(service.getCredits(), /CREDITS_UNAVAILABLE/);
});

test('request deadline aborts a hanging credits body, including after response headers', async () => {
    let requestSignal;
    const { service, timers } = load(async (_url, options) => {
        requestSignal = options.signal;
        return { ok: true, json: () => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))) };
    }, { AbortController });
    const pending = service.getCredits();
    await new Promise(resolve => setImmediate(resolve));
    timers.values().next().value();
    await assert.rejects(pending, /USAGE_UNAVAILABLE/);
    assert.equal(requestSignal.aborted, true);
    assert.equal(timers.size, 0);
});
