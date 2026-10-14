function recordProviderCall(fields) {
    // Explicit allowlist: never log prompts, file contents, API keys or user data.
    const { stage, provider, model, prompt_tokens, completion_tokens, reasoning_tokens,
        cost_usd, finish_reason, duration_ms, retry, route, requestedModelId,
        effectiveModelId, fallbackReason } = fields;
    process.stdout.write(`${JSON.stringify({ event: 'provider_call', stage, provider, model,
        prompt_tokens, completion_tokens, reasoning_tokens, cost_usd, finish_reason,
        duration_ms, retry, route, requestedModelId, effectiveModelId, fallbackReason })}\n`);
    if (finish_reason === 'length' || finish_reason === 'MAX_TOKENS') {
        process.stderr.write(`${JSON.stringify({ event: 'provider_length_cutoff', stage, provider, model })}\n`);
    }
}

module.exports = { recordProviderCall };
