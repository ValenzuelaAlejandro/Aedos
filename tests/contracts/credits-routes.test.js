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

test('GET /api/credits returns only the caller IP balance and operational flags', async () => {
    const handlers = {};
    registerCreditsRoutes({ app: { get(path, handler) { handlers[path] = handler; }, post() {} },
        ledger: { getRemaining: async ip => ip === '198.51.100.7' ? 37 : 0 },
        hasGeminiRequestAvailable: async () => true });
    const res = mockResponse();
    await handlers['/api/credits']({ headers: { 'x-forwarded-for': '198.51.100.7' }, socket: {} }, res);
    assert.deepEqual({ daily: res.body.daily, remaining: res.body.remaining, geminiAvailable: res.body.geminiAvailable },
        { daily: 50, remaining: 37, geminiAvailable: true });
    assert.ok(res.body.resetsAt);
    assert.equal(typeof res.body.paidPaused, 'boolean');
    assert.equal(Object.hasOwn(res.body, 'dailySpendUsd'), false);
    assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('POST /api/credits/spend fixes the operation cost at one and reports 402 details', async () => {
    const handlers = {};
    let actualCost;
    registerCreditsRoutes({ app: { get() {}, post(path, handler) { handlers[path] = handler; } },
        ledger: { spend: async (_ip, cost) => { actualCost = cost; return { status: 'insufficient', remaining: 0, resetsAt: '2026-10-14T00:00:00.000Z' }; } },
        hasGeminiRequestAvailable: async () => false });
    const req = { body: { operation: 'add-element', amount: 999 }, headers: { 'idempotency-key': 'add-element-001' },
        socket: { remoteAddress: '127.0.0.1' } };
    const res = mockResponse();
    await handlers['/api/credits/spend'](req, res);
    assert.equal(actualCost, 1);
    assert.equal(res.statusCode, 402);
    assert.deepEqual({ code: res.body.code, cost: res.body.cost, remaining: res.body.remaining, resetsAt: res.body.resetsAt }, {
        code: 'INSUFFICIENT_CREDITS', cost: 1, remaining: 0, resetsAt: '2026-10-14T00:00:00.000Z',
    });
});
