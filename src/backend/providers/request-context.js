const { AsyncLocalStorage } = require('node:async_hooks');

/** Request-local correlation, including the body populated by later middleware. */
const providerRequestContext = new AsyncLocalStorage();

function getProviderContext() {
    const context = providerRequestContext.getStore();
    const body = context?.req?.body;
    return {
        requestId: context?.requestId || null,
        mode: body?.mode === 'pro' || body?.generationMode === 'pro' ? 'pro' : 'flash',
        requestedModelId: body?.modelId || null,
        signal: context?.signal
    };
}

function getProviderSpendState() {
    const context = providerRequestContext.getStore();
    if (!context) return null;
    if (!context.spendState) context.spendState = {
        reservedMicroUsd: 0,
        settledMicroUsd: 0,
        attemptCount: 0,
        startedAt: context.startedAt || Date.now(),
        clientIp: context.clientIp || 'unknown',
    };
    context.spendState.attemptCount = Number(context.spendState.attemptCount) || 0;
    return context.spendState;
}

function getProviderClientIp() {
    const context = providerRequestContext.getStore();
    return context?.clientIp || context?.spendState?.clientIp || 'unknown';
}

module.exports = { providerRequestContext, getProviderContext, getProviderSpendState, getProviderClientIp };
