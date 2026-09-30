const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ERROR_TEXT,
    queueFullGeneration,
    queueFullFinalize,
    proTemporarilyPaused,
    validationFailed,
    invalidTopic,
    sseError,
    powerPointError,
    pdfError,
} = require('../../src/backend/contracts/errors');

test('HTTP error builders preserve captured JSON bodies', () => {
    assert.deepEqual(queueFullGeneration(30), {
        error: 'QUEUE_FULL',
        retryAfterSec: 30,
        message: 'The generation queue is full. Please try again in a few seconds.',
    });
    assert.deepEqual(queueFullFinalize(30), {
        error: 'QUEUE_FULL',
        retryAfterSec: 30,
        message: 'The PDF generation server is at capacity. Please try again in a few seconds.',
    });
    assert.deepEqual(proTemporarilyPaused(30), {
        error: 'PRO_TEMPORARILY_PAUSED',
        retryAfterSec: 30,
        message:
            'Pro mode is temporarily paused due to high system load. Please retry shortly or use Flash mode.',
    });
    assert.deepEqual(validationFailed({ idioma: 'must be one of: es, en, fr, pt, de' }), {
        error: 'Validation failed',
        fields: { idioma: 'must be one of: es, en, fr, pt, de' },
    });
    assert.deepEqual(invalidTopic('Contains restricted patterns'), {
        error: 'Invalid topic: Contains restricted patterns',
    });
    assert.equal(ERROR_TEXT.INVALID_ITEM_TYPE, 'Invalid item type');
});

test('SSE and export error builders preserve captured payloads', () => {
    assert.equal(
        JSON.stringify(sseError('STAGE1_INVALID: AI output has no slides array')),
        '{"error":"STAGE1_INVALID: AI output has no slides array"}',
    );
    assert.equal(
        JSON.stringify(powerPointError('bad html', true)),
        '{"error":"Error generating PowerPoint: bad html","tipo":"contract-violation"}',
    );
    assert.equal(
        JSON.stringify(powerPointError('bad html', false)),
        '{"error":"Error generating PowerPoint: bad html"}',
    );
    assert.equal(
        JSON.stringify(pdfError('browser unavailable')),
        '{"error":"Error generating PDF: browser unavailable"}',
    );
});
