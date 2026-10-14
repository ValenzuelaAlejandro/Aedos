'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MODEL_CATALOG, DEFAULT_MODEL_ID, resolveModelId, validateAttachments,
    validateModelForGeneration, isLocalNvidiaTrialRequest } = require('../../src/backend/config/model-catalog');
const { FREE_MODELS } = require('../../src/backend/config/provider-spend');
const { createSelectedModelRouter } = require('../../src/backend/providers/model-selection');
const { createGenerateHandler } = require('../../src/backend/http/routes/generate');
const { createSkeletonHandler } = require('../../src/backend/pipeline/skeleton');

const ErrorCategory = new Proxy({}, { get: (_, key) => key });
const logger = { info() {}, warn() {}, error() {}, success() {} };
const emptyStream = async function* () {};

test('model allowlist accepts catalog IDs, defaults missing IDs, and rejects unknown or disabled IDs', () => {
    assert.equal(resolveModelId(undefined).model.id, DEFAULT_MODEL_ID);
    assert.equal(resolveModelId('  ').model.id, DEFAULT_MODEL_ID);
    for (const id of Object.keys(MODEL_CATALOG)) {
        const model = MODEL_CATALOG[id];
        assert.equal(resolveModelId(id, undefined, { localNvidiaTrial: model.provider === 'nvidia' }).valid, true, id);
    }
    for (const model of Object.values(MODEL_CATALOG).filter(entry => entry.provider === 'nvidia')) {
        assert.equal(resolveModelId(model.id).code, 'MODEL_NOT_ALLOWED', model.id);
    }
    assert.equal(resolveModelId('openrouter/free').code, 'MODEL_NOT_ALLOWED');
    assert.deepEqual(FREE_MODELS, []);
    assert.equal(resolveModelId('__proto__').code, 'MODEL_NOT_ALLOWED');
    assert.equal(resolveModelId('disabled/model', { 'disabled/model': { enabled: false } }).code, 'MODEL_NOT_ALLOWED');
});

test('unknown model IDs receive an actionable HTTP 422 before generation', async () => {
    const handler = createGenerateHandler({ log: logger, ErrorCategory });
    const res = new FakeResponse();
    await handler({ body: { modelId: 'unlisted/provider-model' } }, res);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'MODEL_NOT_ALLOWED');
    assert.match(res.body.error, /Choose a model/);
});

test('model slide compatibility respects the server output cap', () => {
    const nemotron = MODEL_CATALOG['nvidia/nemotron-3.5-lightning'];
    assert.equal(validateModelForGeneration(nemotron, 'flash', 8).valid, true);
    assert.equal(validateModelForGeneration(nemotron, 'flash', 9).maxSlides, 8);
    assert.equal(validateModelForGeneration(nemotron, 'pro', 8).valid, true);
});

test('schema generation routes the selected model instead of silently using Gemini', async () => {
    const selectedModel = MODEL_CATALOG['anthropic/claude-haiku-5.5'];
    let selectedCalls = 0;
    const handler = createSkeletonHandler({
        sanitizeTema: tema => ({ valid: true, tema }),
        buildSkeletonFileContext: async () => null,
        buildStage1Prompt: tema => `prompt:${tema}`,
        buildStage1RevisionPrompt: () => 'revision',
        tryModelsStage1Thinking: async () => { throw new Error('default route must not run'); },
        trySelectedStage1Thinking: async (_prompt, _context, options) => {
            selectedCalls += 1;
            assert.equal(options.selectedModel.id, selectedModel.id);
            return { provider: 'openrouter', model: selectedModel.providerModelId,
                stream: (async function* () { yield JSON.stringify({ slides: [{ title: 'Tema' }] }); })() };
        },
        extractJson: JSON.parse,
        setSseHeaders() {},
        writeSse: (res, event) => res.write(`data: ${JSON.stringify(event)}\n\n`),
        invalidTopic: () => ({ error: 'invalid' }),
        ERROR_TEXT: {},
        MAX_PRO_SLIDES: 8,
        MAX_FLASH_SLIDES: 15,
        creditsLedger: {
            reserveSchemaRequest: async () => ({ status: 'allowed' }),
            reserve: async () => { throw new Error('initial schema must not reserve credits'); },
        },
        log: logger,
        ErrorCategory,
    });
    const req = new EventEmitter();
    req.body = { modelId: selectedModel.id, tema: 'Tema breve', mode: 'flash', slides: 1 };
    req.headers = {};
    req.socket = { remoteAddress: '127.0.0.1' };
    const chunks = [];
    const res = new EventEmitter();
    res.write = chunk => { chunks.push(chunk); return true; };
    res.end = () => { res.writableEnded = true; };
    res.setHeader = () => {};
    res.flushHeaders = () => {};
    await handler(req, res);
    assert.equal(selectedCalls, 1);
    assert.match(chunks.join(''), /"done":true/);
});

test('NVIDIA Build trial models require opt-in, a key, and loopback outside production', () => {
    const previousMode = process.env.NODE_ENV;
    const previousKey = process.env.NVIDIA_API_KEY;
    const previousEnabled = process.env.ENABLE_NVIDIA_LOCAL;
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_NVIDIA_LOCAL = 'true';
    process.env.NVIDIA_API_KEY = 'test-key';
    const localRequest = { hostname: 'localhost', headers: { host: 'localhost:3000' }, socket: { remoteAddress: '::1' } };
    assert.equal(isLocalNvidiaTrialRequest(localRequest), true);
    assert.equal(resolveModelId('nvidia-build/nemotron-3.5-lightning', undefined,
        { localNvidiaTrial: isLocalNvidiaTrialRequest(localRequest) }).valid, true);
    process.env.ENABLE_NVIDIA_LOCAL = 'false';
    assert.equal(isLocalNvidiaTrialRequest(localRequest), false);
    process.env.ENABLE_NVIDIA_LOCAL = 'true';
    localRequest.socket.remoteAddress = '198.51.100.20';
    assert.equal(isLocalNvidiaTrialRequest(localRequest), false);
    localRequest.socket.remoteAddress = '::1';
    process.env.NODE_ENV = 'production';
    assert.equal(isLocalNvidiaTrialRequest(localRequest), false);
    delete process.env.NVIDIA_API_KEY;
    assert.equal(isLocalNvidiaTrialRequest(localRequest), false);
    assert.equal(resolveModelId('nvidia-build/nemotron-3.5-lightning', undefined,
        { localNvidiaTrial: isLocalNvidiaTrialRequest(localRequest) }).code, 'MODEL_NOT_ALLOWED');
    if (previousEnabled === undefined) delete process.env.ENABLE_NVIDIA_LOCAL;
    else process.env.ENABLE_NVIDIA_LOCAL = previousEnabled;
    process.env.NODE_ENV = previousMode;
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
});

test('attachments require Gemini and an available Gemini request', () => {
    const gemini = MODEL_CATALOG[DEFAULT_MODEL_ID];
    const paid = MODEL_CATALOG['anthropic/claude-haiku-5.5'];
    assert.equal(validateAttachments(gemini, true, true).valid, true);
    assert.equal(validateAttachments(gemini, true, false).code, 'ATTACHMENTS_NOT_ALLOWED');
    assert.equal(validateAttachments(paid, true, true).code, 'ATTACHMENTS_NOT_ALLOWED');
});

test('generate rejects unsupported attachments before provider calls and cleans uploaded files', async () => {
    for (const modelId of ['anthropic/claude-haiku-5.5', DEFAULT_MODEL_ID]) {
        let providerCalls = 0;
        const discarded = [];
        const handler = createGenerateHandler({
            hasGeminiRequestAvailable: async () => false,
            discardUploadedFiles: async files => discarded.push(...files),
            sanitizeTema: tema => ({ valid: true, tema }),
            MAX_PRO_SLIDES: 8, MAX_FLASH_SLIDES: 15,
            trySelectedFlash: async () => { providerCalls += 1; },
            log: logger,
            ErrorCategory
        });
        const res = new FakeResponse();
        const files = [{ path: `${modelId}.tmp` }];
        await handler({ body: { modelId, tema: 'Test', slides: 1, idioma: 'es' }, files }, res);
        assert.equal(res.statusCode, 422, modelId);
        assert.equal(res.body.code, 'ATTACHMENTS_NOT_ALLOWED', modelId);
        assert.equal(providerCalls, 0, modelId);
        assert.deepEqual(discarded, files, modelId);
    }
});

test('Gemini accepts attachments when quota is available and keeps them on Gemini', async () => {
    const files = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }];
    let receivedFiles;
    let openrouterCalls = 0;
    const router = createSelectedModelRouter({
        gemini: async (prompt, stage, model, fileContext) => {
            receivedFiles = fileContext;
            return { provider: 'gemini', model, stream: emptyStream() };
        },
        openrouter: async () => { openrouterCalls += 1; throw new Error('Unexpected OpenRouter call.'); },
        makeBaseCaller: () => async () => { throw new Error('Unexpected base route.'); },
        getOverride: () => null,
        createStub: () => { throw new Error('Unexpected test stub.'); },
        providerLog: logger,
        ErrorCategory,
        shouldUseTestStub: () => false
    });
    const result = await router.makeCaller('Flash', 'gemini-3-flash-preview', [])(
        'prompt', files, { selectedModel: MODEL_CATALOG[DEFAULT_MODEL_ID] }
    );
    assert.deepEqual(receivedFiles, files);
    assert.equal(openrouterCalls, 0);
    assert.equal(result.modelRoute.effectiveModelId, DEFAULT_MODEL_ID);
});

test('every catalog model routes to HTML through its declared provider', async () => {
    for (const model of Object.values(MODEL_CATALOG)) {
        const calls = [];
        const router = createSelectedModelRouter({
            gemini: async (prompt, stage, providerModelId, files, options) => {
                calls.push({ provider: 'gemini', providerModelId, options });
                return { provider: 'gemini', model: providerModelId, stream: emptyStream() };
            },
            openrouter: async (prompt, stage, models, files, options) => {
                calls.push({ provider: 'openrouter', models, options });
                return { provider: 'openrouter', model: models[0], stream: emptyStream() };
            },
            nvidia: async (prompt, stage, selected, options) => {
                calls.push({ provider: 'nvidia', providerModelId: selected.providerModelId, options });
                return { provider: 'nvidia', model: selected.providerModelId, stream: emptyStream() };
            },
            makeBaseCaller: () => async () => { throw new Error('Selected routing must not use the base caller.'); },
            getOverride: () => null,
            createStub: () => { throw new Error('Unexpected test stub.'); },
            providerLog: logger,
            ErrorCategory,
            shouldUseTestStub: () => false
        });
        const result = await router.makeCaller('Stage3', 'gemini-3.5-flash', [])(
            'prompt', null, { selectedModel: model }
        );
        assert.equal(calls.length, 1, model.id);
        assert.equal(calls[0].provider, model.provider, model.id);
        if (model.provider === 'openrouter') {
            assert.deepEqual(calls[0].models, [model.providerModelId]);
            assert.equal(calls[0].options.maxOutputTokens, model.outputMaxTokens);
            if (model.providerOnly) assert.deepEqual(calls[0].options.providerSelection.providerOnly, ['deepinfra']);
        } else {
            assert.equal(calls[0].providerModelId, model.providerModelId);
        }
        assert.equal(result.modelRoute.requestedModelId, model.id);
        assert.equal(result.modelRoute.effectiveModelId, model.id);
    }
});

test('a failed paid selection stops when no approved free model is available', async () => {
        const attemptedModels = [];
        const router = createSelectedModelRouter({
            gemini: async () => { throw new Error('Should skip Gemini when no key is configured.'); },
            openrouter: async (prompt, stage, models) => {
                attemptedModels.push(...models);
                if (models[0] === 'anthropic/claude-haiku-5.5') throw new Error('PAID_PAUSED');
                return { provider: 'openrouter', model: models[0], stream: emptyStream() };
            },
            makeBaseCaller: () => async () => { throw new Error('Unexpected base route.'); },
            getOverride: () => null,
            createStub: () => { throw new Error('Unexpected test stub.'); },
            providerLog: logger,
            ErrorCategory,
            hasGeminiKey: () => false,
            shouldUseTestStub: () => false
        });
        await assert.rejects(router.makeCaller('Stage3', 'gemini-3.5-flash', ['anthropic/claude-haiku-5.5'])(
            'prompt', null, { selectedModel: MODEL_CATALOG['anthropic/claude-haiku-5.5'] }
        ), /PROVIDER_UNAVAILABLE/);
        assert.deepEqual(attemptedModels, ['anthropic/claude-haiku-5.5']);
});

test('fallback tries Gemini before OpenRouter free and records the effective model', async () => {
        const openrouterCalls = [];
        const router = createSelectedModelRouter({
            gemini: async (prompt, stage, model) => ({ provider: 'gemini', model, stream: emptyStream() }),
            openrouter: async (prompt, stage, models) => {
                openrouterCalls.push(models[0]);
                throw new Error('OPENROUTER_ACCEPT_TIMEOUT');
            },
            makeBaseCaller: () => async () => { throw new Error('Unexpected base route.'); },
            getOverride: () => null,
            createStub: () => { throw new Error('Unexpected test stub.'); },
            providerLog: logger,
            ErrorCategory,
            hasGeminiKey: () => true,
            shouldUseTestStub: () => false
        });
        const result = await router.makeCaller('Stage3', 'gemini-3.5-flash', [])(
            'prompt', null, { selectedModel: MODEL_CATALOG['openai/gpt-6-luna'] }
        );
        assert.deepEqual(openrouterCalls, ['openai/gpt-6-luna']);
        assert.equal(result.modelRoute.effectiveModelId, 'gemini-3.5-flash');
        assert.equal(result.modelRoute.fallbackReason, 'timeout');
});

test('a failed Gemini selection does not call a paid model without an approved free alternative', async () => {
        const attempts = [];
        const router = createSelectedModelRouter({
            gemini: async () => { attempts.push('gemini'); throw new Error('GEMINI_HTTP_503'); },
            openrouter: async (prompt, stage, models) => {
                attempts.push(...models);
                return { provider: 'openrouter', model: models[0], stream: emptyStream() };
            },
            makeBaseCaller: () => async () => { throw new Error('Unexpected base route.'); },
            getOverride: () => null,
            createStub: () => { throw new Error('Unexpected test stub.'); },
            providerLog: logger,
            ErrorCategory,
            hasGeminiKey: () => false,
            shouldUseTestStub: () => false
        });
        await assert.rejects(router.makeCaller('Flash', 'gemini-3-flash-preview', ['anthropic/claude-haiku-5.5'])(
            'prompt', null, { selectedModel: MODEL_CATALOG[DEFAULT_MODEL_ID] }
        ), /PROVIDER_UNAVAILABLE/);
        assert.deepEqual(attempts, ['gemini']);
});

class FakeResponse extends EventEmitter {
    constructor() {
        super();
        this.writes = [];
        this.writableEnded = false;
        this.destroyed = false;
        this.headersSent = false;
        this.statusCode = 200;
    }
    status(code) { this.statusCode = code; return this; }
    json(body) { this.body = body; this.writableEnded = true; return this; }
    write(chunk) { this.headersSent = true; this.writes.push(chunk); return true; }
    end() { this.writableEnded = true; }
}

test('Pro final SSE event reports requested and effective model IDs after selected routing', async () => {
        const configuredStages = [];
        const router = createSelectedModelRouter({
            gemini: async (prompt, stage, model) => ({ provider: 'gemini', model, stream: emptyStream() }),
            openrouter: async (prompt, stage, models) => {
                if (models[0] === 'anthropic/claude-haiku-5.5') throw new Error('PAID_PAUSED');
                return { provider: 'openrouter', model: models[0], stream: emptyStream() };
            },
            makeBaseCaller: () => async () => { throw new Error('Unexpected base route.'); },
            getOverride: () => null,
            createStub: () => { throw new Error('Unexpected test stub.'); },
            providerLog: logger,
            ErrorCategory,
            hasGeminiKey: () => true,
            shouldUseTestStub: () => false
        });
        const noop = () => {};
        const deps = {
            log: logger, ErrorCategory,
            ERROR_TEXT: { SKELETON_EMPTY: 'SKELETON_EMPTY', API_KEY_MISSING: 'API_KEY_MISSING' },
            sanitizeTema: tema => ({ valid: true, tema }),
            invalidTopic: reason => ({ error: 'INVALID_TOPIC', reason }),
            validationFailed: fields => ({ error: 'VALIDATION_FAILED', fields }),
            setSseHeaders: noop,
            generationQueue: { enqueue: async () => 'acquired', release: noop },
            buildGenerationFileContext: async () => null,
            discardUploadedFiles: async () => {},
            hasGeminiRequestAvailable: async () => true,
            hasProviderCredentials: () => true,
            runFlashGenerationWithRetry: noop,
            runPipeline: async options => {
                await options.tryModelsStage1('stage 1 prompt', null, { reasoning: null });
                await options.tryModelsStage2('stage 2 prompt', null, { reasoning: null });
                const stage3Stream = await options.tryModelsStage3('stage 3 prompt', null, { reasoning: null });
                return { stage3Stream, stage3Route: stage3Stream.modelRoute, contentJson: {}, designJson: {} };
            },
            consumeModelStream: async () => ({
                fullHtml: '<!doctype html><html><head><style>section.s{width:1px}</style></head><body><section class="s"></section></body></html>',
                hasStartedValidContent: true
            }),
            tryModelsFlash: noop,
            trySelectedFlash: router.makeCaller('Flash', 'gemini-3-flash-preview', []),
            tryModelsStage1Thinking: async (prompt, files, options) => configuredStages.push({ stage: 'schema', ...options }),
            tryModelsStage2Thinking: async (prompt, files, options) => configuredStages.push({ stage: 'design', ...options }),
            tryModelsStage3Thinking: noop,
            trySelectedStage3Thinking: router.makeCaller('Stage3', 'gemini-3.5-flash', []),
            buildPrompt: noop,
            MAX_PRO_SLIDES: 8, MAX_FLASH_SLIDES: 15,
            sanitizeGeneratedHtml: html => html,
            injectLayoutSafetyNet: html => html,
            sanitizerLog: logger,
            IS_DEVELOPMENT: false,
            TMP_DIR: '', fs: {}, path: {},
            devLog: logger, classifyError: error => error,
            extractPresentationTitle: noop, buildFileStemFromTitle: noop, resolveUniqueHtmlPath: noop,
            EXAMPLES_FLASH_DIR: '', EXAMPLES_PRO_DIR: ''
        };
        const handler = createGenerateHandler(deps);
        const res = new FakeResponse();
        await handler({
            body: {
                tema: 'Test', mode: 'pro', slides: 1, idioma: 'es',
                modelId: 'anthropic/claude-haiku-5.5'
            },
            requestId: 'model-route-test'
        }, res);
        const events = res.writes.filter(chunk => chunk.startsWith('data: '))
            .map(chunk => JSON.parse(chunk.slice(6).trim()));
        const done = events.findLast(event => event.done === true);
        assert.equal(res.statusCode, 200);
        assert.equal(done.requestedModelId, 'anthropic/claude-haiku-5.5');
        assert.equal(done.effectiveModelId, 'gemini-3.5-flash');
        assert.equal(done.fallbackReason, 'paid_paused');
        assert.deepEqual(configuredStages.map(stage => stage.stage), ['schema', 'design']);
        assert.ok(configuredStages.every(stage => stage.selectedModel === undefined));
        assert.ok(configuredStages.every(stage => stage.modelRoute.requestedModelId === 'anthropic/claude-haiku-5.5'));
});
