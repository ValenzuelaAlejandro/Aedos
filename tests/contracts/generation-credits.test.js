const assert = require('node:assert/strict');
const test = require('node:test');
const { quoteModel, createGenerationCreditsMiddleware } = require('../../src/backend/http/middleware/generation-credits');
const { MODEL_CATALOG } = require('../../src/backend/config/model-catalog');

function makeResponse() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

test('server catalog is the only source of mode-specific usage prices', () => {
    assert.equal(quoteModel(MODEL_CATALOG['google/gemini-3-flash-preview'], 8), 12_800);
    assert.equal(quoteModel(MODEL_CATALOG['nvidia/nemotron-3.5-lightning'], 3), 2_400);
    assert.equal(quoteModel(MODEL_CATALOG['openai/gpt-6-luna'], 5), 6_000);
    assert.equal(quoteModel(MODEL_CATALOG['google/gemini-3-flash-preview'], 3, 15, 'pro'), 9_600);
    assert.equal(quoteModel(MODEL_CATALOG['google/gemini-3-flash-preview'], 1, 1, 'pro'),
        2 * quoteModel(MODEL_CATALOG['google/gemini-3-flash-preview'], 1, 1, 'flash'));
});

test('partial presentation settlement is proportional and never exceeds the reservation', () => {
    const model = MODEL_CATALOG['google/gemini-3-flash-preview'];
    assert.equal(quoteModel(model, 0, 15), 0);
    assert.equal(quoteModel(model, 1, 15), 1600);
    assert.equal(quoteModel(model, 15, 15, 'pro'), 48_000);
    assert.equal(quoteModel(MODEL_CATALOG['nvidia/nemotron-3.5-lightning'], 2, 8, 'pro'), 3200);
});

test('insufficient balance returns 402 before the generation handler can call a provider', async () => {
    let providerCalls = 0;
    let nextCalls = 0;
    const middleware = createGenerationCreditsMiddleware({ ledger: {
        async reserve(_ip, cost) { return { allowed: false, code: 'INSUFFICIENT_USAGE', cost, remaining: 4000 }; },
    } });
    const req = { body: { modelId: 'openai/gpt-6-luna', mode: 'pro', slides: 2 },
        headers: { 'idempotency-key': 'generation-request-1' }, hostname: 'localhost', socket: { remoteAddress: '127.0.0.1' } };
    const res = makeResponse();
    await middleware(req, res, () => { nextCalls += 1; providerCalls += 1; });
    assert.equal(res.statusCode, 402);
    assert.deepEqual({ cost: res.body.costUnits, remaining: res.body.remainingUnits }, { cost: 4_800, remaining: 4000 });
    assert.ok(res.body.resetsAt);
    assert.equal(nextCalls, 0);
    assert.equal(providerCalls, 0);
});

test('generation middleware ignores client-supplied price fields and reserves the catalog quote', async () => {
    let received;
    const middleware = createGenerationCreditsMiddleware({ ledger: {
        async reserve(ip, cost, id) { received = { ip, cost, id }; return { allowed: true, remaining: 35, keys: {} }; },
    } });
    const req = { body: { modelId: 'anthropic/claude-haiku-5.5', mode: 'flash', slides: 5,
        creditsPerSlide: 0, cost: 0 }, headers: { 'idempotency-key': 'generation-request-2' },
    hostname: 'example.test', socket: { remoteAddress: '203.0.113.9' } };
    const res = makeResponse();
    let nextCalls = 0;
    await middleware(req, res, () => { nextCalls += 1; });
    assert.deepEqual(received, { ip: '203.0.113.9', cost: 6_000, id: 'generation-request-2' });
    assert.equal(req.creditCost, 6_000);
    assert.equal(nextCalls, 1);
});
