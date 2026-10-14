'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNvidiaProvider, modelSettings } = require('../../src/backend/providers/nvidia');
const { MODEL_CATALOG } = require('../../src/backend/config/model-catalog');

test('NVIDIA Build provider uses documented thinking controls and model output ceilings', async () => {
    const previousKey = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = 'test-key';
    let requestBody;
    const response = {
        ok: true,
        body: (async function* () {
            yield new TextEncoder().encode('data: {"choices":[{"delta":{"content":"<html lang=\\"es\\"><body>ok</body></html>"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"completion_tokens_details":{"reasoning_tokens":0}}}\n\ndata: [DONE]\n\n');
        })(),
    };
    const provider = createNvidiaProvider({
        providerLog: { info() {}, warn() {}, success() {} },
        ErrorCategory: {},
        fetcher: async (_url, options) => { requestBody = JSON.parse(options.body); return response; },
    });
    try {
        const model = MODEL_CATALOG['nvidia-build/nemotron-3.5-lightning'];
        const result = await provider.call('short prompt', 'Stage3', model, { modelRoute: { requestedModelId: model.id } });
        let output = '';
        for await (const chunk of result.stream) output += chunk;
        assert.match(output, /<html lang=/);
        assert.equal(requestBody.max_tokens, 16384);
        assert.deepEqual(requestBody.chat_template_kwargs, { enable_thinking: false });
    } finally {
        if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
        else process.env.NVIDIA_API_KEY = previousKey;
    }
});

test('GLM 5.3 uses its documented minimum reasoning effort and clears hidden thoughts', () => {
    assert.deepEqual(modelSettings('z-ai/glm-5.3'), {
        reasoning_effort: 'low', chat_template_kwargs: { clear_thinking: true },
    });
});
