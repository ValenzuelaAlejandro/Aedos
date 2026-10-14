'use strict';

const { OUTPUT_TOKENS } = require('../config/provider-spend');
const { recordProviderCall } = require('./telemetry');

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const STREAM_TIMEOUT_MS = 180000;

function modelSettings(modelId) {
    if (modelId.startsWith('nvidia/nemotron-3')) {
        return { chat_template_kwargs: { enable_thinking: false } };
    }
    if (modelId === 'z-ai/glm-5.3') {
        return { reasoning_effort: 'low', chat_template_kwargs: { clear_thinking: true } };
    }
    return {};
}

/* eslint-disable complexity -- Parse standard NVIDIA OpenAI-compatible SSE frames in one bounded reader. */
async function* nvidiaChunks(response, includeReasoning, onMetadata) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;
            let frame;
            try { frame = JSON.parse(data); } catch (_) { continue; }
            onMetadata(frame);
            const delta = frame.choices?.[0]?.delta;
            if (!delta) continue;
            const reasoning = delta.reasoning_content || delta.reasoning || '';
            if (includeReasoning && reasoning) yield { type: 'reasoning', text: reasoning };
            if (typeof delta.content === 'string' && delta.content) {
                yield includeReasoning ? { type: 'content', text: delta.content } : delta.content;
            }
        }
    }
}

function createNvidiaProvider({ providerLog, ErrorCategory, fetcher = fetch }) {
    async function call(prompt, stageName, selectedModel, options = {}) {
        const key = process.env.NVIDIA_API_KEY;
        if (!key || selectedModel?.provider !== 'nvidia') throw new Error('PROVIDER_UNAVAILABLE');
        const model = selectedModel.providerModelId;
        const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        const maxTokens = Math.min(OUTPUT_TOKENS[stageName], selectedModel.outputMaxTokens,
            selectedModel.stageOutputMaxTokens?.[stageName] || Number.MAX_SAFE_INTEGER);
        const body = {
            model,
            messages: [{ role: 'user', content: promptText }],
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: maxTokens,
            ...modelSettings(model)
        };
        const controller = new AbortController();
        const started = Date.now();
        const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
        let response;
        try {
            response = await fetcher(NVIDIA_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            if (!response.ok) {
                await response.text();
                providerLog.warn(ErrorCategory.PROVIDER, 'NVIDIA trial endpoint rejected request', {
                    stage: stageName, model, status: response.status
                });
                throw new Error(`NVIDIA_HTTP_${response.status}`);
            }
        } catch (error) {
            clearTimeout(timer);
            recordProviderCall({ stage: stageName, provider: 'nvidia', model,
                prompt_tokens: null, completion_tokens: null, reasoning_tokens: null, cost_usd: null,
                finish_reason: error.name === 'AbortError' ? 'accept_timeout' : error.message,
                duration_ms: Date.now() - started, retry: 0, route: 'trial',
                requestedModelId: options.modelRoute?.requestedModelId, effectiveModelId: model });
            throw error.name === 'AbortError' ? new Error('NVIDIA_ACCEPT_TIMEOUT', { cause: error }) : error;
        }
        let usage = null;
        let finish = null;
        const includeReasoning = options.includeReasoning === true;
        const onMetadata = frame => {
            if (frame.usage) usage = frame.usage;
            if (frame.choices?.[0]?.finish_reason) finish = frame.choices[0].finish_reason;
        };
        async function* stream() {
            try {
                yield* nvidiaChunks(response, includeReasoning, onMetadata);
            } catch (error) {
                if (error.name === 'AbortError') throw new Error('NVIDIA_STREAM_TIMEOUT', { cause: error });
                throw error;
            } finally {
                clearTimeout(timer);
                recordProviderCall({ stage: stageName, provider: 'nvidia', model,
                    prompt_tokens: usage?.prompt_tokens ?? null,
                    completion_tokens: usage?.completion_tokens ?? null,
                    reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
                    cost_usd: null, finish_reason: finish,
                    duration_ms: Date.now() - started, retry: 0, route: 'trial',
                    requestedModelId: options.modelRoute?.requestedModelId, effectiveModelId: model });
            }
        }
        return { stream: stream(), provider: 'nvidia', model };
    }
    return { call };
}

module.exports = { createNvidiaProvider, modelSettings, nvidiaChunks };
