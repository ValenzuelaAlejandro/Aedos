const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeminiProvider } = require('../../src/backend/providers/gemini');
const { createOpenRouterProvider } = require('../../src/backend/providers/openrouter');
const { createSelectedModelRouter } = require('../../src/backend/providers/model-selection');
const { createModelConfig } = require('../../src/backend/config/models');
const { MODEL_CATALOG, DEFAULT_MODEL_ID } = require('../../src/backend/config/model-catalog');
const { sseResponse, jsonFrame } = require('../helpers/provider-fakes');
const { deferred } = require('../helpers/provider-fakes');
const { validateStageOutput } = require('../../src/backend/providers/output-validation');
const { runStage, runContentStageWithRetry } = require('../../src/backend/prompts/stage-runner');

const guard = { reserveGeminiRequest: async () => true, reserve: async () => ({ allowed: true }),
    settle: async () => true, release: async () => true };
const logger = { warn() {} };
const content = '{"slides":[{"title":"Complete response"}]}';

async function drain(result) { for await (const chunk of result.stream) { assert.ok(chunk); } return result; }

function setup(fail, stage = 'Stage1', modelId = DEFAULT_MODEL_ID) {
    process.env.GEMINI_API_KEY = 'fake-direct';
    process.env.OPENROUTER_API_KEY = 'fake-router';
    const calls = [];
    const output = stage === 'Flash' ? '<html><head><style>section.s{width:1280px}</style></head><body><section class="s">Complete response</section></body></html>' : content;
    const common = { guard, providerAcceptTimeoutMs: 10,
        fetchWithAcceptTimeout: async (url, options) => {
            const body = JSON.parse(options.body);
            const provider = url.includes('googleapis') ? 'gemini' : 'openrouter';
            calls.push({ provider, body });
            if (provider === 'gemini') return fail();
            return sseResponse([jsonFrame({ model: modelId, provider: 'verified-endpoint', choices: [{ delta: { content: output }, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']);
        } };
    const router = createSelectedModelRouter({ gemini: createGeminiProvider(common).call,
        openrouter: createOpenRouterProvider({ ...common, reasoningForStage: createModelConfig({}).reasoningForStage }).call,
        providerLog: logger, ErrorCategory: {}, sleep: async () => {}, shouldUseTestStub: () => false, validateOutput: validateStageOutput });
    return { calls, output, call: (options = {}) => router.makeCaller(stage)('Topic', null, {
        selectedModel: MODEL_CATALOG[modelId], includeReasoning: true, streamIdleTimeoutMs: 5, streamTotalTimeoutMs: 50,
        ...options }) };
}

test('same-model fallback preserves a stricter caller token cap and cannot exceed the hard stage cap', async () => {
    for (const [requested, expected] of [[128, 128], [999_999, 8192]]) {
        const { call, calls } = setup(() => new Response('', { status: 429 }), 'Flash');
        await drain(await call({ maxOutputTokens: requested }));
        assert.equal(calls[0].body.generationConfig.maxOutputTokens, expected);
        assert.equal(calls[1].body.max_tokens, expected);
    }
});

const failures = {
    'HTTP 429': () => new Response('', { status: 429 }),
    'HTTP 500': () => new Response('', { status: 500 }),
    'acceptance timeout': () => { throw new Error('GEMINI_ACCEPT_TIMEOUT'); },
    'empty response': () => sseResponse([jsonFrame({ candidates: [{ finishReason: 'STOP' }] })]),
    'midstream disconnect': () => sseResponse([jsonFrame({ candidates: [{ content: { parts: [{ text: 'DISCARD_THIS_PARTIAL' }] } }] }),
        { delayMs: 1, error: new Error('stream disconnected') }]),
    'clean EOF without finish': () => sseResponse([jsonFrame({ candidates: [{ content: { parts: [{ text: 'DISCARD_THIS_PARTIAL' }] } }] })]),
    'malformed SSE': () => sseResponse(['data: {broken\n\n']),
    'invalid completed output': () => sseResponse([jsonFrame({ candidates: [{ content: { parts: [{ text: 'invalid' }] }, finishReason: 'STOP' }] })]),
    'structured stream error': () => sseResponse([jsonFrame({ error: { code: 500, message: 'upstream failed' } })]),
    'idle stream timeout': () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(': heartbeat\n\n')); } }))
};

for (const stage of ['Stage1', 'Flash']) for (const [name, failure] of Object.entries(failures)) {
    test(`${stage}: ${name} delivers only complete same-model fallback`, async () => {
        const { call, calls, output } = setup(failure, stage);
        const result = await call();
        let delivered = '';
        let resets = 0;
        for await (const chunk of result.stream) {
            if (chunk.type === 'reset') { delivered = ''; resets++; }
            else if (typeof chunk === 'string') delivered += chunk;
            else if (chunk.type === 'content') delivered += chunk.text;
        }
        assert.equal(delivered, output);
        assert.equal(resets, 1);
        assert.deepEqual(calls.map(item => item.provider), ['gemini', 'openrouter']);
        assert.equal(calls[1].body.model, DEFAULT_MODEL_ID);
        assert.equal(calls[1].body.models, undefined);
        assert.deepEqual(calls[1].body.reasoning, { effort: 'low' });
        assert.deepEqual(calls[1].body.provider, { sort: 'price', allow_fallbacks: true,
            require_parameters: true, max_price: { prompt: 0.5, completion: 3 } });
        assert.equal(result.modelRoute.effectiveModelId, DEFAULT_MODEL_ID);
        assert.ok(result.modelRoute.fallbackReason);
    });
}

test('persistent safety stops after exactly one alternate attempt', async () => {
    let direct = 0, alternate = 0;
    const router = createSelectedModelRouter({ gemini: async () => { direct++; throw new Error('PROVIDER_SAFETY'); },
        openrouter: async () => { alternate++; throw new Error('PROVIDER_SAFETY'); },
        providerLog: logger, ErrorCategory: {}, sleep: async () => {}, shouldUseTestStub: () => false });
    await assert.rejects(async () => drain(await router.makeCaller('Stage1')('Topic', null, { selectedModel: MODEL_CATALOG[DEFAULT_MODEL_ID] })), /PROVIDER_SAFETY/);
    assert.equal(direct, 1); assert.equal(alternate, 1);
});

test('a Gemini safety frame permits one successful same-model alternate', async () => {
    const { call, calls } = setup(() => sseResponse([jsonFrame({ promptFeedback: { blockReason: 'SAFETY' } })]));
    const result = await call();
    await drain(result);
    assert.equal(calls.length, 2);
    assert.equal(result.modelRoute.fallbackReason, 'safety');
});

for (const modelId of ['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna', 'nvidia/nemotron-3.5-lightning']) {
    test(`${modelId} retries without reaching direct Gemini or another model`, async () => {
        const tried = [];
        const router = createSelectedModelRouter({ gemini: async () => assert.fail('model changed'),
            openrouter: async (_p, _s, models) => {
                tried.push(models);
                if (tried.length < 3) throw new Error('OPENROUTER_HTTP_503');
                return { stream: (async function* () { yield content; })(), provider: 'openrouter', model: modelId };
            }, providerLog: logger, ErrorCategory: {}, sleep: async () => {}, shouldUseTestStub: () => false });
        const result = await router.makeCaller('Flash')('Topic', null, { selectedModel: MODEL_CATALOG[modelId] });
        await drain(result);
        assert.deepEqual(tried, [[modelId], [modelId], [modelId]]);
        assert.equal(result.modelRoute.effectiveModelId, modelId);
    });
}

test('client cancellation never starts a fallback request', async () => {
    const controller = new AbortController();
    let calls = 0;
    const router = createSelectedModelRouter({ gemini: async () => { controller.abort(); throw new Error('PROVIDER_CANCELLED'); },
        openrouter: async () => { calls++; }, providerLog: logger, ErrorCategory: {}, shouldUseTestStub: () => false });
    await assert.rejects(async () => drain(await router.makeCaller('Flash')('Topic', null, { signal: controller.signal })), /PROVIDER_CANCELLED/);
    assert.equal(calls, 0);
});

test('request total timeout resets the live partial before the final error and never adds a provider call', async () => {
    const controller = new AbortController();
    let openRouterCalls = 0;
    const router = createSelectedModelRouter({
        gemini: async () => ({ provider: 'gemini', model: DEFAULT_MODEL_ID, stream: (async function* () {
            yield 'partial timeout draft';
            controller.abort(new Error('REQUEST_TOTAL_TIMEOUT'));
            throw new Error('PROVIDER_REQUEST_TIMEOUT');
        })() }),
        openrouter: async () => { openRouterCalls += 1; throw new Error('must not retry beyond request deadline'); },
        providerLog: logger, ErrorCategory: {}, shouldUseTestStub: () => false
    });
    const result = await router.makeCaller('Stage1')('Topic', null, {
        selectedModel: MODEL_CATALOG[DEFAULT_MODEL_ID], signal: controller.signal
    });
    const iterator = result.stream[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value.type, 'metadata');
    assert.equal((await iterator.next()).value, 'partial timeout draft');
    assert.deepEqual(await iterator.next(), { value: { type: 'reset', stage: 'Stage1', attempt: 1, reason: 'request_timeout' }, done: false });
    await assert.rejects(iterator.next(), /PROVIDER_REQUEST_TIMEOUT/);
    assert.equal(openRouterCalls, 0);
});

for (const stage of ['Stage1', 'Flash']) test(`${stage}: partial content is delivered before the attempt fails, then reset before fallback`, async () => {
    const gate = deferred();
    const { call } = setup(() => sseResponse([
        jsonFrame({ candidates: [{ content: { parts: [{ text: 'LIVE_PARTIAL' }] } }] }),
        { waitFor: gate.promise, error: new Error('lost connection') }
    ]), stage);
    const result = await call();
    const iterator = result.stream[Symbol.asyncIterator]();
    const metadata = await iterator.next();
    assert.equal(metadata.value.type, 'metadata');
    let timer;
    const partial = await Promise.race([iterator.next(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('live streaming was buffered')), 500);
    })]).finally(() => clearTimeout(timer));
    assert.equal(partial.value.text, 'LIVE_PARTIAL');
    gate.release();
    const reset = await iterator.next();
    assert.equal(reset.value.type, 'reset');
    let visible = '';
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) if (chunk.type === 'content') visible += chunk.text;
    assert.ok(!visible.includes('LIVE_PARTIAL'));
    assert.match(visible, /Complete response/);
});

test('Pro content stages clear failed JSON and signal when retry content resumes', async () => {
    const updates = [];
    const result = await runStage(async () => ({ stream: (async function* () {
        yield { type: 'content', text: 'FAILED JSON' };
        yield { type: 'reset', stage: 'Stage1', attempt: 1 };
        yield { type: 'reasoning', text: 'working' };
        yield { type: 'content', text: content };
    })() }), 'Topic', 'Stage1', chunk => updates.push(chunk));
    assert.equal(result, content);
    assert.equal(updates.filter(update => update.type === 'resumed').length, 1);
    assert.ok(updates.findIndex(update => update.type === 'resumed') > updates.findIndex(update => update.type === 'reasoning'));
});

test('exhausted provider safety cannot restart the outer Pro retry loop', async () => {
    let attempts = 0;
    await assert.rejects(runContentStageWithRetry({ stageName: 'Content', stageKey: 'stage1', maxRetries: 2,
        task: async () => { attempts++; throw new Error('PROVIDER_SAFETY'); } }), /PROVIDER_SAFETY/);
    assert.equal(attempts, 1);
});
