(function registerCreditsService(global) {
    'use strict';

    function createRequestId() {
        if (global.crypto?.randomUUID) return global.crypto.randomUUID();
        const bytes = new Uint8Array(16);
        if (global.crypto?.getRandomValues) global.crypto.getRandomValues(bytes);
        else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    async function getJson(path, unavailableCode) {
        const controller = global.AbortController ? new global.AbortController() : null;
        const timer = controller ? global.setTimeout(() => controller.abort(), 15000) : null;
        let response;
        try {
        try {
            response = await global.fetch(path, { credentials: 'same-origin', cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
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
        } finally { if (timer !== null) global.clearTimeout(timer); }
    }

    async function getCredits() {
        const data = await getJson('/api/usage', 'USAGE_UNAVAILABLE');
        if (!Number.isSafeInteger(data.remainingUnits) || data.remainingUnits < 0
            || !Number.isSafeInteger(data.dailyUnits) || data.dailyUnits < data.remainingUnits) {
            const error = new Error('CREDITS_UNAVAILABLE'); error.retryable = true; throw error;
        }
        return { ...data, balance: data.remainingUnits, dailyLimit: data.dailyUnits, source: 'api' };
    }

    async function getModels() {
        const data = await getJson('/api/models', 'MODELS_UNAVAILABLE');
        return { models: data.models || [], paymentsPaused: Boolean(data.paymentsPaused), source: 'api' };
    }

    function createRefresher({ onSuccess, onUnavailable, onCredits, onModels, onModelsUnavailable }) {
        let inFlight = null;
        let retryTimer = null;
        let latestModels = { models: [], paymentsPaused: false };

        return function refresh() {
            if (inFlight) return inFlight;
            inFlight = (async () => {
                try {
                    const [creditResult, modelResult] = await Promise.allSettled([
                        getCredits().then(credits => { onCredits?.(credits); return credits; }),
                        getModels().then(models => { latestModels = models; onModels?.(models); return models; })
                    ]);
                    if (modelResult.status === 'rejected') onModelsUnavailable?.(modelResult.reason);
                    if (creditResult.status === 'rejected') throw creditResult.reason;
                    if (retryTimer) global.clearTimeout(retryTimer);
                    retryTimer = null;
                    if (modelResult.status === 'rejected' && !retryTimer) retryTimer = global.setTimeout(() => { retryTimer = null; refresh(); }, 10000);
                    return onSuccess(creditResult.value, latestModels);
                } catch (error) {
                    onUnavailable(error);
                    if (error?.retryable && !retryTimer) retryTimer = global.setTimeout(() => {
                        retryTimer = null;
                        refresh();
                    }, 10000);
                    return null;
                } finally {
                    inFlight = null;
                }
            })();
            return inFlight;
        };
    }

    function quote(model, slides, mode = global.AedosStores?.generation?.state?.proModeEnabled ? 'pro' : 'flash') {
        const count = Math.max(1, Math.floor(Number(slides) || 1));
        if (model?.billing === 'perSlide') {
            const rate = Number(model.usagePerSlideUnits?.[mode]);
            if (!Number.isSafeInteger(rate) || rate <= 0) throw new Error('INVALID_MODEL_USAGE_RATE');
            const total = count * rate;
            return { billing: 'perSlide', mode, slides: count, rate, total,
                ratePercent: rate / 500, totalPercent: total / 500 };
        }
        throw new Error('INVALID_MODEL_USAGE_RATE');
    }

    async function spend(_amount, reason = 'add-element', requestId = createRequestId()) {
        if (reason === 'chat') throw new Error('CHAT_USAGE_SERVER_AUTHORITATIVE');
        const operation = reason === 'add-element' ? 'add-element' : null;
        if (!operation) throw new Error('INVALID_CREDIT_OPERATION');
        const response = await global.fetch('/api/credits/spend', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'Idempotency-Key': requestId },
            body: JSON.stringify({ operation }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 402 && data.code === 'INSUFFICIENT_USAGE') {
            return { ok: false, balance: data.remainingUnits, required: data.costUnits, resetsAt: data.resetsAt };
        }
        if (!response.ok) throw new Error(data.code || data.error || 'CREDIT_OPERATION_FAILED');
        return { ok: true, balance: data.remainingUnits, amount: data.costUnits, resetsAt: data.resetsAt };
    }

    function percent(units, dailyLimit) {
        if (!Number.isFinite(units)) return '—';
        const value = Math.max(0, Number(units) / dailyLimit * 100);
        return value > 0 && value < 1 ? '<1%' : `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
    }
    function quoteChat(model, mode) {
        const total = Number(model?.chatReservationUnits?.[mode]);
        return { slides: 0, billing: 'chat', rate: total, total: Number.isFinite(total) ? total : Infinity };
    }
    const service = Object.freeze({ getCredits, getModels, createRefresher, quote, quoteChat, percent, spend, createRequestId });
    global.AedosCredits = service;
})(typeof window !== 'undefined' ? window : globalThis);
