(function registerCreditsService(global) {
    'use strict';

    const DAILY_LIMIT = 50;
    const STORAGE_KEY = 'aedos-credit-mock-v1';
    const API_MODE_DEFAULT = false;
    const isApiEnabled = () => global.__AEDOS_CREDITS_USE_API__ ?? API_MODE_DEFAULT;

    function localDayKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function nextLocalReset(date = new Date()) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    }

    function readMockState() {
        let saved = null;
        try {
            saved = JSON.parse(global.localStorage?.getItem(STORAGE_KEY) || 'null');
        } catch (_) { /* Use today's mock allowance when storage is unavailable. */ }
        if (!saved || saved.day !== localDayKey() || !Number.isFinite(saved.balance)) {
            saved = { day: localDayKey(), balance: DAILY_LIMIT };
            writeMockState(saved);
        }
        return saved;
    }

    function writeMockState(state) {
        try { global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state)); }
        catch (_) { /* The service remains usable for this tab without storage. */ }
    }

    async function getCredits() {
        if (isApiEnabled()) {
            const response = await global.fetch('/api/credits', { credentials: 'same-origin' });
            if (!response.ok) throw new Error('CREDITS_UNAVAILABLE');
            return response.json();
        }
        const { balance } = readMockState();
        return { balance, dailyLimit: DAILY_LIMIT, resetsAt: nextLocalReset().toISOString(), source: 'mock' };
    }

    async function getModels() {
        if (isApiEnabled()) {
            const response = await global.fetch('/api/models', { credentials: 'same-origin' });
            if (!response.ok) throw new Error('MODELS_UNAVAILABLE');
            const data = await response.json();
            return {
                models: Array.isArray(data) ? data : (data.models || []),
                paymentsPaused: Boolean(data.paymentsPaused),
            };
        }
        return { models: global.MODEL_CATALOG || [], paymentsPaused: false, source: 'mock' };
    }

    function spend(amount, reason = 'generation') {
        const cost = Math.max(0, Math.floor(Number(amount) || 0));
        const state = readMockState();
        if (state.balance < cost) return { ok: false, balance: state.balance, required: cost };
        state.balance -= cost;
        writeMockState(state);
        return { ok: true, balance: state.balance, amount: cost, reason };
    }

    function refund(amount, reason = 'failed-operation') {
        const creditAmount = Math.max(0, Math.floor(Number(amount) || 0));
        const state = readMockState();
        state.balance = Math.min(DAILY_LIMIT, state.balance + creditAmount);
        writeMockState(state);
        return { ok: true, balance: state.balance, amount: creditAmount, reason };
    }

    function setApiMode(enabled) {
        global.__AEDOS_CREDITS_USE_API__ = Boolean(enabled);
    }

    const service = Object.freeze({
        DAILY_LIMIT,
        getCredits,
        getModels,
        spend,
        refund,
        setApiMode,
        localDayKey,
        nextLocalReset,
    });
    global.AedosCredits = service;
})(typeof window !== 'undefined' ? window : globalThis);
