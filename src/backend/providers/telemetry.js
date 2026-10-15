const { randomUUID } = require('node:crypto');
const { getProviderContext } = require('./request-context');
const { persistProviderCall, persistUsageEvent } = require('./telemetry-store');
const { priceCostUsd } = require('../config/usage-policy');
const { redactSecrets } = require('../utils/redact-secrets');

async function recordProviderCall(fields, persist = persistProviderCall) {
    // Explicit allowlist: never log prompts, file contents, API keys or user data.
    const { stage, provider, model, prompt_tokens, completion_tokens, reasoning_tokens,
        cost_usd, finish_reason, duration_ms, retry, route, requestedModelId,
        effectiveModelId, fallbackReason, outcome, errorCode, cost_estimated, cost_basis, respondingProvider } = fields;
    const context = getProviderContext();
    const row = redactSecrets({ event: 'provider_call', requestId: context.requestId,
        attemptId: randomUUID(), timestamp: new Date().toISOString(), mode: context.mode,
        stage, provider, respondingProvider, model,
        prompt_tokens, completion_tokens, reasoning_tokens, cost_usd,
        finish_reason: finish_reason && /^[A-Za-z0-9_]+$/.test(finish_reason) ? finish_reason : null,
        duration_ms, retry, route, requestedModelId: requestedModelId || context.requestedModelId,
        effectiveModelId, fallbackReason: fallbackReason || null,
        fallback: Boolean(fallbackReason), outcome,
        errorCode: errorCode ? (/^[A-Z][A-Z0-9_]+$/.test(errorCode) ? errorCode : 'PROVIDER_NETWORK_ERROR') : null, cost_estimated, cost_basis });
    process.stdout.write(`${JSON.stringify(row)}\n`);
    if (finish_reason === 'length' || finish_reason === 'MAX_TOKENS') {
        process.stderr.write(`${JSON.stringify({ event: 'provider_length_cutoff', stage: row.stage, provider: row.provider, model: row.model })}\n`);
    }
    let timer;
    try {
        const stored = await Promise.race([persist(row), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
        if (!stored) process.stderr.write(`${JSON.stringify({ event: 'provider_telemetry_unavailable', requestId: row.requestId, attemptId: row.attemptId })}\n`);
    } catch (_) {
        process.stderr.write(`${JSON.stringify({ event: 'provider_telemetry_unavailable', requestId: row.requestId, attemptId: row.attemptId })}\n`);
    } finally { clearTimeout(timer); }
    return row;
}

async function recordChatUsage({ requestId, modelId, mode, inputTokens, outputTokens, usageUnits, estimated }, persist = persistUsageEvent) {
    const row = redactSecrets({ event: 'chat_usage', eventId: randomUUID(), requestId: requestId || getProviderContext().requestId,
        timestamp: new Date().toISOString(), model: modelId, mode,
        input_tokens: inputTokens, completion_tokens: outputTokens, usage_units: usageUnits,
        cost_usd: priceCostUsd(modelId, inputTokens, outputTokens), cost_estimated: Boolean(estimated) });
    process.stdout.write(`${JSON.stringify(row)}\n`);
    let timer;
    try {
        const stored = await Promise.race([persist(row), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
        if (!stored) process.stderr.write(`${JSON.stringify({ event: 'provider_telemetry_unavailable', requestId: row.requestId, eventId: row.eventId })}\n`);
    } catch (_) {
        process.stderr.write(`${JSON.stringify({ event: 'provider_telemetry_unavailable', requestId: row.requestId, eventId: row.eventId })}\n`);
    } finally { clearTimeout(timer); }
    return row;
}

module.exports = { recordProviderCall, recordChatUsage };
