'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createModelRequestValidationMiddleware } = require('../../src/backend/http/middleware/model-request-validation');

test('unsupported document model is rejected before the rate limiter middleware runs', async () => {
    let geminiAvailabilityChecks = 0;
    let nextCalled = false;
    const cleaned = [];
    const middleware = createModelRequestValidationMiddleware({
        hasGeminiRequestAvailable: async () => { geminiAvailabilityChecks += 1; return true; },
        discardUploadedFiles: async files => cleaned.push(...files),
    });
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = function status(code) { this.statusCode = code; return this; };
    res.json = function json(body) { this.body = body; return this; };
    const files = [{ path: 'temporary-upload.pdf' }];
    await middleware({ body: { modelId: 'anthropic/claude-haiku-5.5' }, files }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'ATTACHMENTS_NOT_ALLOWED');
    assert.equal(nextCalled, false);
    assert.equal(geminiAvailabilityChecks, 1);
    assert.deepEqual(cleaned, files);
});

test('an unknown model is rejected before checking attachments or continuing', async () => {
    let geminiAvailabilityChecks = 0;
    let nextCalled = false;
    const middleware = createModelRequestValidationMiddleware({
        hasGeminiRequestAvailable: async () => { geminiAvailabilityChecks += 1; return true; },
    });
    const res = {
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
    await middleware({ body: { modelId: 'not-allowlisted' }, files: [] }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'MODEL_NOT_ALLOWED');
    assert.equal(nextCalled, false);
    assert.equal(geminiAvailabilityChecks, 0);
});
