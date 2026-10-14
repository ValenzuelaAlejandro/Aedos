(function registerCreditsService(global) {
    'use strict';

    function createRequestId() {
        if (global.crypto?.randomUUID) return global.crypto.randomUUID();
        return `aedos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    async function getJson(path, unavailableCode) {
        let response;
        try {
            response = await global.fetch(path, { credentials: 'same-origin', cache: 'no-store' });
        } catch (cause) {
            const error = new Error(unavailableCode, { cause });
            error.retryable = true;
            throw error;
        }
        if (!response.ok) {
            const error = new Error(unavailableCode);
            error.retryable = [502, 503, 504].includes(response.status);
            throw error;
        }
        try {
            return await response.json();
        } catch (cause) {
            // Render can briefly return a startup page while the sleeping service wakes.
            const error = new Error(unavailableCode, { cause });
            error.retryable = true;
            throw error;
        }
    }

    async function getCredits() {
        const data = await getJson('/api/credits', 'CREDITS_UNAVAILABLE');
        return { ...data, balance: data.remaining, dailyLimit: data.daily, source: 'api' };
    }

    async function getModels() {
        const data = await getJson('/api/models', 'MODELS_UNAVAILABLE');
        return { models: data.models || [], paymentsPaused: Boolean(data.paymentsPaused), source: 'api' };
    }

    function quote(model, slides) {
        const count = Math.max(1, Math.floor(Number(slides) || 1));
        if (model?.billing === 'perPresentation') {
            const rate = Number(model.creditsPerPresentation);
            if (!Number.isSafeInteger(rate) || rate < 0) throw new Error('INVALID_MODEL_BILLING');
            return { billing: 'perPresentation', slides: count, rate, total: rate };
        }
        if (model?.billing === 'perSlide') {
            const rate = Number(model.creditsPerSlide);
            if (!Number.isSafeInteger(rate) || rate <= 0) throw new Error('INVALID_MODEL_BILLING');
            return { billing: 'perSlide', slides: count, rate, total: count * rate };
        }
        throw new Error('INVALID_MODEL_BILLING');
    }

    async function spend(_amount, reason = 'add-element', requestId = createRequestId()) {
        const operation = reason === 'chat' ? 'chat' : reason === 'add-element' ? 'add-element' : null;
        if (!operation) throw new Error('INVALID_CREDIT_OPERATION');
        const response = await global.fetch('/api/credits/spend', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'Idempotency-Key': requestId },
            body: JSON.stringify({ operation }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 402 && data.code === 'INSUFFICIENT_CREDITS') {
            return { ok: false, balance: data.remaining, required: data.cost, resetsAt: data.resetsAt };
        }
        if (!response.ok) throw new Error(data.code || data.error || 'CREDIT_OPERATION_FAILED');
        return { ok: true, balance: data.remaining, amount: data.cost, resetsAt: data.resetsAt };
    }

    const service = Object.freeze({ getCredits, getModels, quote, spend, createRequestId });
    global.AedosCredits = service;
})(typeof window !== 'undefined' ? window : globalThis);
