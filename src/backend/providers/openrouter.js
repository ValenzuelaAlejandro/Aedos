/* eslint-disable complexity */
/** @typedef {{info: Function, warn: Function, success: Function}} ProviderLogger */
/** @typedef {Record<string, string>} ErrorCategories */

async function* openRouterStructuredSSE(response) {
    const decoder = new TextDecoder(); let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim(); if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6); if (data === '[DONE]') return;
            try {
                const delta = JSON.parse(data).choices?.[0]?.delta; if (!delta) continue;
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

async function* openRouterSSEToChunks(response) {
    const decoder = new TextDecoder(); let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim(); if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6); if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.content?.[0];
                if (content) yield content;
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

/**
 * Create the unchanged sequential OpenRouter fallback provider.
 * @param {{fetchWithAcceptTimeout: Function, providerLog: ProviderLogger, classifyError: Function, ErrorCategory: ErrorCategories, providerAcceptTimeoutMs: number, modelList: string[], stage3Only: string[], reasoningForStage: Function}} deps provider dependencies
 * @returns {{call: Function}}
 */
function createOpenRouterProvider({ fetchWithAcceptTimeout, providerLog, classifyError, ErrorCategory, providerAcceptTimeoutMs, modelList, stage3Only, reasoningForStage }) {
    async function call(prompt, stageName, openrouterModels, fileContext = null, options = {}) {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) throw new Error('QUOTA_EXHAUSTED');
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
            throw new Error('OPENROUTER_MODELS_UNAVAILABLE');
        }
        const reasoningConfig = options && options.reasoning === null ? null : options && options.reasoning && typeof options.reasoning === 'object' ? options.reasoning : reasoningForStage(stageName);
        const includeReasoning = options && options.includeReasoning === true;
        for (const model of modelsToTry) {
            const normalizedModel = model.toLowerCase();
            const providerOrder = normalizedModel.includes('deepseek') ? ['SiliconFlow'] : stageName === 'Flash' && normalizedModel.includes('mimo') ? ['Xiaomi', 'Parasail'] : null;
            providerLog.info(ErrorCategory.PROVIDER, 'Trying OpenRouter model', { stage: stageName, model, reasoning: reasoningConfig || 'disabled', providerOrder: providerOrder || 'default' });
            try {
                const body = { model, messages: [{ role: 'user', content: messagesContent }], stream: true };
                if (providerOrder) body.provider = { order: providerOrder, allow_fallbacks: true };
                if (reasoningConfig) body.reasoning = reasoningConfig;
                const response = await fetchWithAcceptTimeout('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.APP_URL || 'https://aedos.app', 'X-Title': 'Aedos' }, body: JSON.stringify(body)
                }, providerAcceptTimeoutMs, 'OPENROUTER_ACCEPT_TIMEOUT');
                if (!response.ok) {
                    const errText = await response.text();
                    providerLog.warn(ErrorCategory.PROVIDER, 'OpenRouter model request failed', { stage: stageName, model, status: response.status, details: errText });
                    continue;
                }
                providerLog.success(ErrorCategory.PROVIDER, 'OpenRouter model accepted request', { stage: stageName, model, reasoning: reasoningConfig || 'disabled' });
                return { stream: includeReasoning ? openRouterStructuredSSE(response) : openRouterSSEToChunks(response), provider: 'openrouter', model };
            } catch (err) {
                if (err?.message === 'OPENROUTER_ACCEPT_TIMEOUT') providerLog.warn(ErrorCategory.NETWORK, 'OpenRouter accept timeout', { stage: stageName, model, timeoutMs: providerAcceptTimeoutMs });
                else providerLog.warn(classifyError(err, ErrorCategory.NETWORK), 'OpenRouter request error', { stage: stageName, model, error: err });
            }
        }
        throw new Error('QUOTA_EXHAUSTED');
    }
    return { call };
}

module.exports = { createOpenRouterProvider };
