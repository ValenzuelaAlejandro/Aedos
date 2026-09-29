/* eslint-disable complexity, eqeqeq, no-empty */
const GEMINI_503_MAX_RETRIES = 2;
const GEMINI_503_RETRY_BASE_DELAY_MS = 500;

/** @typedef {{info: Function, warn: Function, success: Function}} ProviderLogger */
/** @typedef {Record<string, string>} ErrorCategories */

function toGeminiParts(promptText, fileContext, providerLog, ErrorCategory) {
    const parts = [];
    const supported = new Set(['application/pdf']);
    if (Array.isArray(fileContext)) {
        for (const item of fileContext) {
            if (item.type === 'text') parts.push({ text: item.text });
            else if (item.type === 'image_url' && item.image_url?.url) {
                const match = item.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
                if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            } else if (item.type === 'file' && item.file_url?.url) {
                const match = item.file_url.url.match(/^data:([^;]+);base64,(.+)$/);
                if (match && (match[1].startsWith('image/') || supported.has(match[1]))) {
                    parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                } else if (match) {
                    providerLog.warn(ErrorCategory.PROVIDER, 'Skipping unsupported inlineData mime for Gemini', { mimeType: match[1] });
                }
            }
        }
    }
    parts.push({ text: promptText });
    return parts;
}

async function* geminiSSEToChunks(response) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            try {
                const text = JSON.parse(data).candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) yield text;
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

async function* geminiSSEToStructuredChunks(response) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            try {
                const parts = JSON.parse(data).candidates?.[0]?.content?.parts;
                if (!Array.isArray(parts)) continue;
                for (const part of parts) {
                    if (!part || typeof part.text !== 'string' || part.text.length === 0) continue;
                    const reasoning = part.thought === true || typeof part.thought === 'string'
                        || part.thoughtSummary === true || typeof part.thoughtSummary === 'string'
                        || part.thoughtSignature != null;
                    yield { type: reasoning ? 'reasoning' : 'content', text: part.text };
                }
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

/**
 * Create the unchanged Gemini direct provider and its 503 retry wrapper.
 * @param {{fetchWithAcceptTimeout: Function, providerLog: ProviderLogger, ErrorCategory: ErrorCategories, providerAcceptTimeoutMs: number}} deps provider dependencies
 * @returns {{call: Function}}
 */
function createGeminiProvider({ fetchWithAcceptTimeout, providerLog, ErrorCategory, providerAcceptTimeoutMs }) {
    async function call(prompt, stageName, geminiModel, fileContext = null, options = {}) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_KEY_MISSING');
        const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        const parts = toGeminiParts(promptText, fileContext, providerLog, ErrorCategory);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
        providerLog.info(ErrorCategory.PROVIDER, 'Trying Gemini direct model', {
            stage: stageName, model: geminiModel,
            parts: { text: parts.filter(p => p.text).length, inlineData: parts.filter(p => p.inlineData).length }
        });
        const includeReasoning = options && options.includeReasoning === true;
        const requestBody = { contents: [{ role: 'user', parts }] };
        if (includeReasoning) requestBody.generationConfig = { thinkingConfig: { thinkingBudget: 4096 } };
        let response;
        try {
            response = await fetchWithAcceptTimeout(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody)
            }, providerAcceptTimeoutMs, 'GEMINI_ACCEPT_TIMEOUT');
        } catch (err) {
            if (err?.message === 'GEMINI_ACCEPT_TIMEOUT') providerLog.warn(ErrorCategory.NETWORK, 'Gemini direct accept timeout', {
                stage: stageName, model: geminiModel, timeoutMs: providerAcceptTimeoutMs
            });
            throw err;
        }
        if (!response.ok) {
            const errText = await response.text();
            let errReason = errText;
            try { errReason = JSON.parse(errText)?.error?.message || errText; } catch (_) {}
            providerLog.warn(ErrorCategory.PROVIDER, 'Gemini direct request failed — will fall back to OpenRouter', {
                stage: stageName, model: geminiModel, status: response.status, reason: errReason.substring(0, 300)
            });
            throw new Error(`GEMINI_HTTP_${response.status}`);
        }
        providerLog.success(ErrorCategory.PROVIDER, 'Gemini direct accepted request', { stage: stageName, model: geminiModel });
        return { stream: includeReasoning ? geminiSSEToStructuredChunks(response) : geminiSSEToChunks(response), provider: 'gemini', model: geminiModel };
    }

    async function callWithRetry(prompt, stageName, geminiModel, fileContext = null, options = null) {
        let lastErr;
        for (let attempt = 1; attempt <= GEMINI_503_MAX_RETRIES; attempt++) {
            try { return await call(prompt, stageName, geminiModel, fileContext, options); }
            catch (err) {
                lastErr = err;
                const retryable = err?.message === 'GEMINI_ACCEPT_TIMEOUT' || err?.message === 'GEMINI_HTTP_503';
                if (!retryable || attempt === GEMINI_503_MAX_RETRIES) throw err;
                const delay = GEMINI_503_RETRY_BASE_DELAY_MS * attempt;
                providerLog.warn(ErrorCategory.PROVIDER, 'Gemini direct request was retryable, retrying', {
                    stage: stageName, model: geminiModel, attempt, maxRetries: GEMINI_503_MAX_RETRIES, delayMs: delay, error: err.message
                });
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
        throw lastErr;
    }
    return { call: callWithRetry };
}

module.exports = { createGeminiProvider };
