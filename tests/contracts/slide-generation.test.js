'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createGenerateHandler } = require('../../src/backend/http/routes/generate');
const { createMemoryCreditsLedger } = require('../../src/backend/utils/credits-ledger');
const { MODEL_CATALOG } = require('../../src/backend/config/model-catalog');

const ErrorCategory = new Proxy({}, { get: (_target, key) => key });
const logger = { info() {}, warn() {}, error() {}, success() {} };

class FakeResponse extends EventEmitter {
    constructor() { super(); this.writes = []; this.writableEnded = false; this.destroyed = false; this.headersSent = false; this.statusCode = 200; }
    status(code) { this.statusCode = code; return this; }
    json(body) { this.body = body; this.writableEnded = true; return this; }
    write(chunk) { this.headersSent = true; this.writes.push(chunk); return true; }
    end() { this.writableEnded = true; }
}

function htmlWithSlides(count, start = 1) {
    const slides = Array.from({ length: count }, (_, offset) =>
        `<section class="s"><h1>Slide ${start + offset}</h1></section>`).join('');
    return `<!doctype html><html><head><style>section.s{width:1px}</style></head><body>${slides}</body></html>`;
}

function makeDeps({ firstSlides, repairBehavior, ledger, reservation,
    selectedModel = MODEL_CATALOG['anthropic/claude-haiku-5.5'] } = {}) {
    let initialStage3 = true;
    const repairCalls = [];
    const deps = {
        log: logger, ErrorCategory,
        ERROR_TEXT: { SKELETON_EMPTY: 'SKELETON_EMPTY', API_KEY_MISSING: 'API_KEY_MISSING' },
        sanitizeTema: tema => ({ valid: true, tema }),
        invalidTopic: reason => ({ error: 'INVALID_TOPIC', reason }),
        validationFailed: fields => ({ error: 'VALIDATION_FAILED', fields }),
        setSseHeaders() {},
        generationQueue: { enqueue: async () => 'acquired', release() {} },
        buildGenerationFileContext: async () => null,
        hasProviderCredentials: () => true,
        trySelectedFlash: async () => { throw new Error('Flash should not run in this Pro test.'); },
        trySelectedStage3Thinking: async (prompt, _files, options) => {
            assert.equal(options.selectedModel.id, selectedModel.id);
            if (initialStage3) {
                initialStage3 = false;
                return { provider: 'openrouter', model: selectedModel.providerModelId,
                    modelRoute: { requestedModelId: selectedModel.id, effectiveModelId: selectedModel.id }, initial: true };
            }
            repairCalls.push({ prompt, options });
            return repairBehavior({ prompt, options, call: repairCalls.length });
        },
        runPipeline: async options => {
            assert.equal(options.requestedSlides, 15);
            const stage3Stream = await options.tryModelsStage3('original stage 3 prompt', null, {});
            return { stage3Stream, contentJson: { slides: Array.from({ length: 15 }, (_, index) => ({ index: index + 1 })) } };
        },
        consumeModelStream: async (_streamDeps, streamResult, _res, _id, _cancelled, _limit, options) => {
            if (options?.baselineHtml) {
                const fragment = streamResult?.html || '';
                return { fullHtml: options.baselineHtml + fragment, repairHtml: fragment, hasStartedValidContent: true };
            }
            return { fullHtml: htmlWithSlides(firstSlides), hasStartedValidContent: true };
        },
        MAX_PRO_SLIDES: 15, MAX_FLASH_SLIDES: 8,
        sanitizeGeneratedHtml: html => html,
        injectLayoutSafetyNet: html => html,
        sanitizerLog: logger,
        IS_DEVELOPMENT: false, TMP_DIR: '', fs: {}, path: {}, devLog: logger,
        classifyError: error => error,
        creditsLedger: ledger,
    };
    return { deps, repairCalls, selectedModel, reservation };
}

function eventsFrom(response) {
    return response.writes.filter(chunk => chunk.startsWith('data: '))
        .map(chunk => JSON.parse(chunk.slice(6).trim()));
}

test('Pro 15 repairs only missing slides in batches with the selected model and returns 15', async () => {
    const { deps, repairCalls, selectedModel } = makeDeps({
        firstSlides: 8,
        repairBehavior: ({ prompt }) => {
            const count = Number(prompt.match(/exactly (\d+) new/)[1]);
            const first = Number(prompt.match(/slide indexes ([0-9, ]+)/)[1].split(',')[0]);
            return { modelRoute: { requestedModelId: selectedModel.id, effectiveModelId: selectedModel.id },
                html: htmlWithSlides(count, first).replace(/^.*?<body>/s, '').replace('</body></html>', '') };
        }
    });
    const response = new FakeResponse();
    await createGenerateHandler(deps)({ requestId: 'slide-count-pro-15', body: {
        tema: 'Solar power', mode: 'pro', slides: 15, idioma: 'en', modelId: selectedModel.id
    } }, response);
    const events = eventsFrom(response);
    const done = events.findLast(event => event.done);
    assert.equal(done.warning, undefined);
    assert.equal((done.html.match(/<section class="s">/g) || []).length, 15);
    assert.deepEqual(repairCalls.map(call => Number(call.prompt.match(/exactly (\d+) new/)[1])), [3, 3, 1]);
    assert.ok(repairCalls.every(call => call.options.selectedModel.id === selectedModel.id));
    assert.ok(repairCalls[0].prompt.includes('slide indexes 9, 10, 11'));
});

test('exhausted slide repair clears partial fragment, reports delivery, and settles only delivered slides', async () => {
    const ledger = createMemoryCreditsLedger({ daily: 150_000 });
    const selectedModel = MODEL_CATALOG['anthropic/claude-haiku-5.5'];
    const reservation = await ledger.reserve('127.0.0.1', 90_000, 'partial-slides-reservation');
    const { deps } = makeDeps({
        firstSlides: 7, ledger, reservation,
        repairBehavior: () => ({ html: '<section class="s"><h1>unaccepted partial' })
    });
    const response = new FakeResponse();
    await createGenerateHandler(deps)({ requestId: 'partial-slide-run', creditReservation: reservation, body: {
        tema: 'Solar power', mode: 'pro', slides: 15, idioma: 'en', modelId: selectedModel.id
    } }, response);
    const events = eventsFrom(response);
    const done = events.findLast(event => event.done);
    assert.deepEqual(done.warning, { code: 'SLIDES_INCOMPLETE', requested: 15, delivered: 7 });
    assert.equal((done.html.match(/<section class="s">/g) || []).length, 7);
    assert.doesNotMatch(done.html, /unaccepted partial/);
    assert.equal(await ledger.getRemaining('127.0.0.1'), 150_000 - (7 * 2400));
    assert.ok(events.some(event => event.reset));
    assert.ok(events.some(event => event.replay && (event.chunk || '').includes('Slide 7')));
});

test('Gemini Pro 15 UI estimate equals the successful handler debit and leaves 4%, which cannot start this chat', async () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const window = {};
    for (const file of ['src/frontend/config/model-catalog.js', 'src/frontend/features/credits/credits-service.js']) {
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window });
    }
    const model = MODEL_CATALOG['google/gemini-3-flash-preview'];
    const displayedQuote = window.AedosCredits.quote(window.MODEL_CATALOG.find(entry => entry.id === model.id), 15, 'pro');
    const ledger = createMemoryCreditsLedger();
    const { deps } = makeDeps({ firstSlides: 15, ledger, selectedModel: model,
        repairBehavior: () => assert.fail('A complete presentation needs no repair.') });
    const { createGenerationCreditsMiddleware } = require('../../src/backend/http/middleware/generation-credits');
    const req = { requestId: 'quote-completion-proof', headers: { 'idempotency-key': 'quote-completion-proof' },
        socket: { remoteAddress: '127.0.0.1' }, body: { tema: 'Solar power', slides: 15, mode: 'pro', idioma: 'en', modelId: model.id } };
    const response = new FakeResponse();
    await createGenerationCreditsMiddleware({ ledger })(req, response, () => {});
    await createGenerateHandler(deps)(req, response);
    assert.ok(eventsFrom(response).findLast(event => event.done));
    assert.equal(await ledger.getRemaining('127.0.0.1'), 50000 - displayedQuote.total);
    assert.equal(await ledger.getRemaining('127.0.0.1'), 2000);
    assert.ok(model.chatReservationUnits.pro > 2000);
    assert.ok(model.usagePerSlideUnits.flash <= 2000);
    const { reserveChatUsageUnits, MAX_CHAT_INPUT_TOKENS, MIN_START_USAGE_UNITS } = require('../../src/backend/config/usage-policy');
    const chatReserve = reserveChatUsageUnits(model.id, 'pro', MAX_CHAT_INPUT_TOKENS);
    assert.equal(chatReserve, model.chatReservationUnits.pro);
    assert.ok(MIN_START_USAGE_UNITS * 2 < 2000, 'The settled minimum is not permission to skip the full start reservation.');
    assert.equal((await ledger.reserve('127.0.0.1', chatReserve, 'next-chat')).allowed, false);
});
