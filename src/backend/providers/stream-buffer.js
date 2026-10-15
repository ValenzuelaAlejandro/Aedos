const { abortProviderResponse } = require('./common');

const MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const { MAX_STAGE_STREAM_DURATION_MS } = require('../config/provider-spend');
const configuredTotalTimeout = Number(process.env.STAGE_TIMEOUT_MS);
const DEFAULT_TOTAL_TIMEOUT_MS = Number.isFinite(configuredTotalTimeout) && configuredTotalTimeout > 0
    ? Math.min(configuredTotalTimeout, MAX_STAGE_STREAM_DURATION_MS) : MAX_STAGE_STREAM_DURATION_MS;

function streamError(code) { return Object.assign(new Error(code), { code }); }
function signalError(signal) {
    return streamError(signal?.reason?.message === 'REQUEST_TOTAL_TIMEOUT'
        ? 'PROVIDER_REQUEST_TIMEOUT' : 'PROVIDER_CANCELLED');
}

/**
 * Yield live SSE chunks and validate termination; callers own retry/reset events.
 * @param {Response} response
 * @param {{provider: string, includeReasoning?: boolean, onMetadata?: (frame: any) => void, signal?: AbortSignal, idleTimeoutMs?: number, totalTimeoutMs?: number}} options
 */
// eslint-disable-next-line complexity, max-lines-per-function -- Keep reader cleanup and validation within one stream lifetime.
async function* readProviderStream(response, { provider, includeReasoning = false,
    onMetadata = () => {}, signal, idleTimeoutMs = 30000,
    totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS }) {
    const reader = response.body?.getReader();
    if (!reader) throw streamError('PROVIDER_EMPTY_RESPONSE');
    const decoder = new TextDecoder();
    const chunks = [];
    let buffer = '', data = [], terminal = false, doneMarker = false, content = '', bytes = 0, reportedUsage = null;
    const started = Date.now();

    // eslint-disable-next-line complexity -- Provider frame schemas have optional text, reasoning, safety and usage variants.
    function acceptFrame() {
        if (!data.length) return;
        const raw = data.join('\n'); data = [];
        if (raw === '[DONE]') { terminal = true; doneMarker = true; return; }
        let frame;
        try { frame = JSON.parse(raw); } catch (_) { throw streamError('PROVIDER_MALFORMED_SSE'); }
        onMetadata(frame);
        if (provider === 'gemini' && frame.usageMetadata) {
            const meta = frame.usageMetadata;
            if (Number.isFinite(meta.promptTokenCount) && Number.isFinite(meta.candidatesTokenCount)) {
                reportedUsage = { inputTokens: meta.promptTokenCount,
                    outputTokens: meta.candidatesTokenCount + (Number(meta.thoughtsTokenCount) || 0),
                    reasoningTokens: Number(meta.thoughtsTokenCount) || 0, reported: true };
            }
        } else if (provider === 'openrouter' && frame.usage
            && Number.isFinite(frame.usage.prompt_tokens) && Number.isFinite(frame.usage.completion_tokens)) {
            reportedUsage = { inputTokens: frame.usage.prompt_tokens, outputTokens: frame.usage.completion_tokens,
                reasoningTokens: frame.usage.completion_tokens_details?.reasoning_tokens || frame.usage.reasoning_tokens || 0,
                costUsd: Number.isFinite(frame.usage.cost) ? frame.usage.cost : null, reported: true };
        }
        if (frame.error) {
            const blocked = frame.error.code === 403 || /safety|content.filter|moderation/i.test(frame.error.message || '');
            throw streamError(blocked ? 'PROVIDER_SAFETY' : 'PROVIDER_STREAM_ERROR');
        }
        const candidate = frame.candidates?.[0];
        const choice = frame.choices?.[0];
        const finish = provider === 'gemini' ? candidate?.finishReason : choice?.finish_reason;
        if (frame.promptFeedback?.blockReason || ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'RECITATION', 'SPII', 'IMAGE_SAFETY', 'content_filter'].includes(finish)) {
            throw streamError('PROVIDER_SAFETY');
        }
        if (finish) {
            if (!['STOP', 'stop', 'end_turn'].includes(finish)) throw streamError('PROVIDER_INCOMPLETE_RESPONSE');
            terminal = true;
        }
        function add(text, reasoning = false) {
            if (typeof text !== 'string' || !text) return;
            if (!reasoning) content += text;
            if (!reasoning || includeReasoning) chunks.push(includeReasoning ? { type: reasoning ? 'reasoning' : 'content', text } : text);
        }
        if (provider === 'gemini') {
            for (const part of candidate?.content?.parts || []) add(part.text, part.thought === true || part.thoughtSummary === true);
        } else {
            const delta = choice?.delta;
            if (!delta) return;
            const reasoningText = delta.reasoning || delta.reasoning_content || delta.reasoning_text || delta.thinking || delta.thought || delta.reasoning_text_delta;
            if (reasoningText) add(reasoningText, true);
            else for (const part of delta.reasoning_details || []) {
                if (part?.type !== 'reasoning.encrypted') add(part?.text || part?.summary || part?.reasoning, true);
            }
            if (Array.isArray(delta.content)) {
                for (const part of delta.content) add(typeof part === 'string' ? part : part?.text, ['reasoning', 'thinking'].includes(part?.type));
            } else add(delta.content);
        }
    }

    function line(text) {
        if (doneMarker || (terminal && provider === 'gemini')) return;
        if (text === '') return acceptFrame();
        if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''));
    }

    try {
        for (;;) {
            if (signal?.aborted) throw signalError(signal);
            const remaining = totalTimeoutMs - (Date.now() - started);
            if (remaining <= 0) throw streamError('PROVIDER_STREAM_TIMEOUT');
            let timer, onAbort;
            let read;
            try {
                read = await Promise.race([reader.read(), new Promise((_, reject) => {
                    timer = setTimeout(() => reject(streamError('PROVIDER_STREAM_TIMEOUT')), Math.min(idleTimeoutMs, remaining));
                    onAbort = () => reject(signalError(signal));
                    signal?.addEventListener('abort', onAbort, { once: true });
                })]);
            } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
            if (read.done) break;
            bytes += read.value.byteLength;
            if (bytes > MAX_BUFFER_BYTES) throw streamError('PROVIDER_OUTPUT_TOO_LARGE');
            buffer += decoder.decode(read.value, { stream: true });
            const lines = buffer.split('\n'); buffer = lines.pop();
            for (const value of lines) line(value.replace(/\r$/, ''));
            yield* chunks.splice(0);
            if (doneMarker || (terminal && provider === 'gemini')) break;
        }
        buffer += decoder.decode();
        if (buffer) line(buffer.replace(/\r$/, ''));
        acceptFrame();
        yield* chunks.splice(0);
        if (!content.trim()) throw streamError('PROVIDER_EMPTY_RESPONSE');
        if (!terminal) throw streamError('PROVIDER_INCOMPLETE_RESPONSE');
        if (reportedUsage) yield { type: 'usage', usage: reportedUsage };
        await reader.cancel();
    } catch (error) {
        abortProviderResponse(response);
        await reader.cancel().catch(() => {});
        throw error;
    } finally {
        abortProviderResponse(response);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

module.exports = { readProviderStream };
