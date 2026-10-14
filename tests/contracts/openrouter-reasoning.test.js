'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenRouterProvider } = require('../../src/backend/providers/openrouter');
const { createModelConfig } = require('../../src/backend/config/models');
const { runPipeline } = require('../../src/backend/prompts/pipeline');

test('Pro pipeline leaves each stage reasoning setting to its configured provider policy', async () => {
    const calls = [];
    const asStream = text => ({ stream: (async function* () { yield text; })() });
    await runPipeline({
        rawInput: 'A short topic',
        targetLanguage: 'Spanish',
        onStageUpdate() {},
        tryModelsStage1: async (...args) => {
            calls.push(['Stage1', args[2]]);
            return asStream('{"topic":"A short topic","slide_count":1,"slides":[{"role":"hook","title":"Intro","subtitle":"Start","key_points":["Point"]}]}');
        },
        tryModelsStage2: async (...args) => {
            calls.push(['Stage2', args[2]]);
            return asStream('{"palette":{"colors_hex":["#123456"]},"slides":[{"title":"Intro"}]}');
        },
        tryModelsStage3: async (...args) => {
            calls.push(['Stage3', args[2]]);
            return asStream('');
        }
    });
    assert.deepEqual(calls, [['Stage1', undefined], ['Stage2', undefined], ['Stage3', undefined]]);
});

test('Haiku schema call sends reasoning disabled and a bounded response budget', async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key';
    let requestBody;
    const response = {
        ok: true,
        body: (async function* () {
            yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{\\"slides\\":[]}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":10,"completion_tokens_details":{"reasoning_tokens":0}}}\n\ndata: [DONE]\n\n');
        })(),
    };
    const provider = createOpenRouterProvider({
        fetchWithAcceptTimeout: async (_url, options) => { requestBody = JSON.parse(options.body); return response; },
        providerLog: { info() {}, warn() {}, success() {} },
        classifyError: () => 'NETWORK',
        ErrorCategory: {},
        providerAcceptTimeoutMs: 100,
        modelList: ['anthropic/claude-haiku-5.5'],
        stage3Only: [],
        reasoningForStage: createModelConfig({ OPENROUTER_REASONING_EFFORT_SCHEMA: 'none' }).reasoningForStage,
        guard: { reserve: async () => ({ allowed: true }), settle: async () => true, release: async () => true },
    });
    try {
        const result = await provider.call('short schema prompt', 'Stage1', ['anthropic/claude-haiku-5.5']);
        for await (const chunk of result.stream) assert.equal(typeof chunk, 'string');
        assert.deepEqual(requestBody.reasoning, { enabled: false });
        assert.equal(requestBody.max_tokens, 4096);
    } finally {
        if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = previousKey;
    }
});
