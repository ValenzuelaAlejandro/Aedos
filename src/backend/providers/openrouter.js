/* eslint-disable complexity, max-lines-per-function */
const { PAID_MODELS, FREE_MODELS, OUTPUT_TOKENS, estimatePaidUsd } = require('../config/provider-spend');
const { spendGuard } = require('../utils/spend-guard');
const { recordProviderCall } = require('./telemetry');
/** @typedef {{info: Function, warn: Function, success: Function}} ProviderLogger */
/** @typedef {Record<string, string>} ErrorCategories */

/** @param {any} response @param {(frame: any) => void} [onMetadata] */
async function* openRouterStructuredSSE(response, onMetadata = () => {}) {
    const decoder = new TextDecoder(); let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim(); if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6); if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                onMetadata(parsed);
                const delta = parsed.choices?.[0]?.delta; if (!delta) continue;
                for (const field of ['reasoning', 'reasoning_content', 'reasoning_text', 'thinking', 'thought', 'reasoning_text_delta']) {
                    if (typeof delta[field] === 'string' && delta[field].length > 0) yield { type: 'reasoning', text: delta[field] };
                }
                if (Array.isArray(delta.reasoning_details)) {
                    let acc = '';
                    for (const detail of delta.reasoning_details) {
                        if (!detail || typeof detail !== 'object' || detail.type === 'reasoning.encrypted') continue;
                        acc += detail.text || detail.summary || detail.reasoning || '';
                    }
                    if (acc.length > 0) yield { type: 'reasoning', text: acc };
                }
                if (Array.isArray(delta.content)) {
                    for (const part of delta.content) {
                        if (typeof part === 'string') yield { type: 'content', text: part };
                        else if (part && typeof part.text === 'string' && part.text.length > 0) yield { type: part.type === 'reasoning' || part.type === 'thinking' ? 'reasoning' : 'content', text: part.text };
                    }
                } else if (typeof delta.content === 'string' && delta.content.length > 0) yield { type: 'content', text: delta.content };
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

/** @param {any} response @param {(frame: any) => void} [onMetadata] */
async function* openRouterSSEToChunks(response, onMetadata = () => {}) {
    const decoder = new TextDecoder(); let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim(); if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6); if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                onMetadata(parsed);
                const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.content?.[0];
                if (content) yield content;
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

/**
 * Create the unchanged sequential OpenRouter fallback provider.
 * @param {{fetchWithAcceptTimeout: Function, providerLog: ProviderLogger, classifyError: Function, ErrorCategory: ErrorCategories, providerAcceptTimeoutMs: number, modelList: string[], stage3Only: string[], reasoningForStage: Function, guard?: any}} deps provider dependencies
 * @returns {{call: Function}}
 */
function createOpenRouterProvider({ fetchWithAcceptTimeout, providerLog, classifyError, ErrorCategory, providerAcceptTimeoutMs, modelList, stage3Only, reasoningForStage, guard = spendGuard }) {
    async function call(prompt, stageName, openrouterModels, fileContext = null, options = {}) {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) throw new Error('PROVIDER_UNAVAILABLE');
        const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        const messagesContent = fileContext && Array.isArray(fileContext) ? [...fileContext, { type: 'text', text: promptText }] : promptText;
        const requestedModels = Array.isArray(openrouterModels) && openrouterModels.length > 0 ? openrouterModels : modelList;
        let modelsToTry = requestedModels;
        if (stageName !== 'Stage3' && stage3Only.length > 0) {
            const blocked = new Set(stage3Only);
            modelsToTry = requestedModels.filter((model) => !blocked.has(String(model || '').trim().toLowerCase()));
        }
        if (!modelsToTry.length) {
            providerLog.warn(ErrorCategory.CONFIG, 'No OpenRouter models available for stage after policy filtering', { stage: stageName, requestedModels });
            throw new Error('PROVIDER_UNAVAILABLE');
        }
        const reasoningConfig = options && options.reasoning === null ? null : options && options.reasoning && typeof options.reasoning === 'object' ? options.reasoning : reasoningForStage(stageName);
        const includeReasoning = options && options.includeReasoning === true;
        let paidPaused = false;
        for (const [index, model] of modelsToTry.entries()) {
            const normalizedModel = model.toLowerCase();
            const route = FREE_MODELS.includes(normalizedModel) ? 'free' : PAID_MODELS[normalizedModel] ? 'paid' : null;
            if (!route) continue; // Unknown model prices or free status cannot be trusted.
            const maxTokens = OUTPUT_TOKENS[stageName];
            const estimatedUsd = route === 'paid' ? estimatePaidUsd(normalizedModel, prompt, fileContext, maxTokens) : 0;
            const reservation = route === 'paid' ? await guard.reserve(estimatedUsd) : null;
            if (route === 'paid' && !reservation?.allowed) { paidPaused = true; continue; }
            const providerOrder = normalizedModel.includes('deepseek') ? ['SiliconFlow'] : stageName === 'Flash' && normalizedModel.includes('mimo') ? ['Xiaomi', 'Parasail'] : null;
            providerLog.info(ErrorCategory.PROVIDER, 'Trying OpenRouter model', { stage: stageName, model, reasoning: reasoningConfig || 'disabled', providerOrder: providerOrder || 'default' });
            const started = Date.now();
            try {
                const body = { model, messages: [{ role: 'user', content: messagesContent }], stream: true,
                    max_tokens: maxTokens, stream_options: { include_usage: true } };
                if (providerOrder) body.provider = { order: providerOrder, allow_fallbacks: true };
                if (reasoningConfig) body.reasoning = reasoningConfig;
                const response = await fetchWithAcceptTimeout('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.APP_URL || 'https://aedos.app', 'X-Title': 'Aedos' }, body: JSON.stringify(body)
                }, providerAcceptTimeoutMs, 'OPENROUTER_ACCEPT_TIMEOUT');
                if (!response.ok) {
                    await response.text();
                    providerLog.warn(ErrorCategory.PROVIDER, 'OpenRouter model request failed', { stage: stageName, model, status: response.status });
                    if (reservation) await guard.release(reservation);
                    recordProviderCall({ stage: stageName, provider: 'openrouter', model, prompt_tokens: null,
                        completion_tokens: null, reasoning_tokens: null, cost_usd: 0, finish_reason: `HTTP_${response.status}`,
                        duration_ms: Date.now() - started, retry: index, route });
                    continue;
                }
                providerLog.success(ErrorCategory.PROVIDER, 'OpenRouter model accepted request', { stage: stageName, model, reasoning: reasoningConfig || 'disabled' });
                let usage = null; let finishReason = null;
                const onMetadata = frame => {
                    if (frame.usage) usage = frame.usage;
                    if (frame.choices?.[0]?.finish_reason) finishReason = frame.choices[0].finish_reason;
                };
                const source = includeReasoning ? openRouterStructuredSSE(response, onMetadata) : openRouterSSEToChunks(response, onMetadata);
                async function* measuredStream() {
                    try { yield* source; }
                    finally {
                        const price = PAID_MODELS[normalizedModel];
                        const long = usage?.prompt_tokens > price?.longPromptThreshold;
                        const cost = Number.isFinite(usage?.cost) ? usage.cost
                            : usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)
                                ? route === 'free' ? 0 : usage.prompt_tokens * (long ? price.longInput : price.input)
                                    + usage.completion_tokens * (long ? price.longOutput : price.output)
                                : estimatedUsd;
                        if (reservation) await guard.settle(reservation, Number.isFinite(cost) ? cost : estimatedUsd);
                        recordProviderCall({ stage: stageName, provider: 'openrouter', model,
                            prompt_tokens: usage?.prompt_tokens ?? null, completion_tokens: usage?.completion_tokens ?? null,
                            reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
                            cost_usd: route === 'free' ? 0 : cost, finish_reason: finishReason,
                            duration_ms: Date.now() - started, retry: index, route });
                    }
                }
                return { stream: measuredStream(), provider: 'openrouter', model };
            } catch (err) {
                // Acceptance timeouts can have charged upstream; retain the reserve.
                recordProviderCall({ stage: stageName, provider: 'openrouter', model, prompt_tokens: null,
                    completion_tokens: null, reasoning_tokens: null, cost_usd: reservation ? estimatedUsd : 0,
                    finish_reason: 'request_error', duration_ms: Date.now() - started, retry: index, route });
                if (err?.message === 'OPENROUTER_ACCEPT_TIMEOUT') providerLog.warn(ErrorCategory.NETWORK, 'OpenRouter accept timeout', { stage: stageName, model, timeoutMs: providerAcceptTimeoutMs });
                else providerLog.warn(classifyError(err, ErrorCategory.NETWORK), 'OpenRouter request error', { stage: stageName, model, error: err });
            }
        }
        throw new Error(paidPaused ? 'PAID_PAUSED' : 'PROVIDER_UNAVAILABLE');
    }
    return { call };
}

module.exports = { createOpenRouterProvider };
