const assert = require('node:assert/strict');
const test = require('node:test');
const { registerCreditsRoutes } = require('../../src/backend/http/routes/credits');

function mockResponse() {
    return {
        statusCode: 200,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        set(name, value) { this.headers[name] = value; return this; },
        json(body) { this.body = body; return this; },
    };
}

test('GET /api/usage returns only the caller IP daily units and operational flags', async () => {
    const handlers = {};
    registerCreditsRoutes({ app: { get(path, handler) { handlers[path] = handler; }, post() {} },
        ledger: { getRemaining: async ip => ip === '198.51.100.7' ? 37 : 0 },
        hasGeminiRequestAvailable: async () => true });
    const res = mockResponse();
    await handlers['/api/usage']({ headers: { 'x-forwarded-for': '198.51.100.7' }, socket: {} }, res);
    assert.deepEqual({ dailyUnits: res.body.dailyUnits, remainingUnits: res.body.remainingUnits, geminiAvailable: res.body.geminiAvailable },
        { dailyUnits: 50_000, remainingUnits: 37, geminiAvailable: true });
    assert.ok(res.body.resetsAt);
    assert.equal(typeof res.body.paidPaused, 'boolean');
    assert.equal(Object.hasOwn(res.body, 'dailySpendUsd'), false);
    assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('POST /api/credits/spend fixes the add-element cost in units and reports 402 details', async () => {
    const handlers = {};
    let actualCost;
    registerCreditsRoutes({ app: { get() {}, post(path, handler) { handlers[path] = handler; } },
        ledger: { spend: async (_ip, cost) => { actualCost = cost; return { status: 'insufficient', remaining: 0, resetsAt: '2026-10-14T00:00:00.000Z' }; } },
        hasGeminiRequestAvailable: async () => false });
    const req = { body: { operation: 'add-element', amount: 999 }, headers: { 'idempotency-key': 'add-element-001' },
        socket: { remoteAddress: '127.0.0.1' } };
    const res = mockResponse();
    await handlers['/api/credits/spend'](req, res);
    assert.equal(actualCost, 1000);
    assert.equal(res.statusCode, 402);
    assert.deepEqual({ code: res.body.code, costUnits: res.body.costUnits, remainingUnits: res.body.remainingUnits, resetsAt: res.body.resetsAt }, {
        code: 'INSUFFICIENT_USAGE', costUnits: 1000, remainingUnits: 0, resetsAt: '2026-10-14T00:00:00.000Z',
    });
});

test('chat usage cannot be charged from a client-supplied amount', async () => {
    const handlers = {};
    let spendCalls = 0;
    registerCreditsRoutes({ app: { get() {}, post(path, handler) { handlers[path] = handler; } },
        ledger: { spend: async () => { spendCalls += 1; return { status: 'spent' }; } } });
    const res = mockResponse();
    await handlers['/api/credits/spend']({ body: { operation: 'chat', amount: 0 }, headers: {}, socket: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'CHAT_USAGE_SERVER_AUTHORITATIVE');
    assert.equal(spendCalls, 0);
});
