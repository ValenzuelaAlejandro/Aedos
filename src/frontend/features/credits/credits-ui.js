(function registerCreditsUi(global) {
    'use strict';

    const MAX_SLIDES = 15;
    let modelList = [];
    let balance = 50;
    let dailyLimit = 50;
    let lastCredits = null;
    let statusKey = '';
    let statusParams = {};

    function format(key, params = {}) {
        return global.__t(key).replace(/\{([a-z]+)\}/g, (match, name) =>
            Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
    }

    function resetTime() {
        const candidate = lastCredits?.resetsAt ? new Date(lastCredits.resetsAt) : global.AedosCredits.nextLocalReset();
        const reset = Number.isNaN(candidate.getTime()) ? global.AedosCredits.nextLocalReset() : candidate;
        const locale = global.currentLang === 'es' ? 'es-MX' : 'en-US';
        // An API ISO timestamp is parsed as an instant, then formatted in the browser's local zone.
        return reset.toLocaleTimeString(locale, {
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
    }

    function selectedModel() {
        return modelList.find(model => model.id === global.AedosStores?.generation?.state?.selectedModelId)
            || global.MODEL_CATALOG?.[0]
            || null;
    }

    function getSlideCount() {
        const input = global.document?.getElementById('slide-count-select');
        const value = Number(input?.value || 8);
        return Math.min(MAX_SLIDES, Math.max(1, Number.isFinite(value) ? value : 8));
    }

    function updateStatus(key = '', state = '', params = {}) {
        statusKey = key;
        statusParams = params;
        const status = global.document?.getElementById('credits-status');
        if (!status) return;
        status.textContent = key ? format(key, params) : '';
        status.hidden = !key;
        status.classList.toggle('hidden', !key);
        status.dataset.state = state;
    }

    function renderBalance(credits) {
        lastCredits = credits;
        balance = Number.isFinite(credits?.balance) ? credits.balance : 0;
        dailyLimit = Number.isFinite(credits?.dailyLimit) ? credits.dailyLimit : 50;
        const balanceNode = global.document.getElementById('credits-balance');
        const popoverBalance = global.document.getElementById('credits-popover-balance');
        const trigger = global.document.getElementById('credits-balance-trigger');
        const progress = global.document.querySelector('.credits-progress[role="meter"]');
        const fill = global.document.getElementById('credits-progress-fill');
        const resetNode = global.document.getElementById('credits-reset-time');
        const count = format('credits.chip', { remaining: balance, total: dailyLimit });
        if (balanceNode) balanceNode.textContent = count;
        if (popoverBalance) popoverBalance.textContent = count;
        if (trigger) trigger.setAttribute('aria-label', format('credits.balanceAria', { remaining: balance, total: dailyLimit }));
        if (fill) fill.style.width = `${dailyLimit > 0 ? Math.max(0, Math.min(100, (balance / dailyLimit) * 100)) : 0}%`;
        if (progress) {
            progress.setAttribute('aria-valuemax', String(dailyLimit));
            progress.setAttribute('aria-valuenow', String(balance));
        }
        if (resetNode) resetNode.textContent = format('credits.resetsAt', { time: resetTime() });
        updateCostPreview();
        if (statusKey) updateStatus(statusKey, global.document.getElementById('credits-status')?.dataset.state || '', statusParams);
    }

    function updateCostPreview() {
        const model = selectedModel();
        const slides = getSlideCount();
        const rate = model?.creditsPerSlide || 3;
        const total = slides * rate;
        const preview = global.document.getElementById('credits-cost-preview');
        const generateButton = global.document.getElementById('btn-generate');
        if (preview) {
            preview.textContent = format(total === 1 ? 'credits.costOne' : 'credits.cost', { n: total });
            preview.setAttribute('aria-label', format('credits.costAria', { n: total }));
        }
        const insufficient = total > balance;
        preview?.classList.toggle('is-insufficient', insufficient);
        if (insufficient) {
            updateStatus(balance <= 0
                ? 'credits.exhausted'
                : 'credits.insufficient',
            balance <= 0 ? 'empty' : 'insufficient',
            { time: resetTime(), cost: total, left: balance });
        } else if (global.document.getElementById('credits-status')?.dataset.state !== 'paused') {
            updateStatus('');
        }
        if (generateButton && !generateButton.classList.contains('is-generating')) {
            const hasPrompt = (global.document.getElementById('w-tema')?.value || '').trim().length >= 4;
            generateButton.disabled = !hasPrompt || insufficient;
            const missing = total - balance;
            const label = insufficient
                ? format(missing === 1 ? 'credits.missingOne' : 'credits.missing', { n: missing })
                : global.__t('credits.generate');
            generateButton.setAttribute('aria-label', label);
            generateButton.setAttribute('data-tooltip', label);
        }
        return { slides, rate, total, affordable: !insufficient };
    }

    function setSlideCount(count) {
        const input = global.document.getElementById('slide-count-select');
        if (!input) return;
        const normalized = Math.min(MAX_SLIDES, Math.max(1, Math.floor(Number(count) || 1)));
        input.value = String(normalized);
        updateCostPreview();
    }

    function canSpend(amount) {
        if (balance < amount) {
            const missing = amount - balance;
            updateStatus(balance <= 0 ? 'credits.exhausted' : (missing === 1 ? 'credits.missingOne' : 'credits.missing'),
                balance <= 0 ? 'empty' : 'insufficient', { time: resetTime(), n: missing });
            return false;
        }
        return true;
    }

    async function refresh() {
        if (!global.AedosCredits) return;
        try {
            const [credits, modelsResult] = await Promise.all([
                global.AedosCredits.getCredits(),
                global.AedosCredits.getModels(),
            ]);
            modelList = modelsResult.models || [];
            renderBalance(credits);
            global.dispatchEvent?.(new global.CustomEvent('aedos:models-updated', {
                detail: { models: modelList, paymentsPaused: modelsResult.paymentsPaused },
            }));
            return { credits, models: modelList, paymentsPaused: modelsResult.paymentsPaused };
        } catch (_) {
            updateStatus('credits.unavailable', 'error');
            return null;
        }
    }

    function initPopover() {
        const trigger = global.document.getElementById('credits-balance-trigger');
        const popover = global.document.getElementById('credits-popover');
        if (!trigger || !popover) return;
        const close = () => { popover.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
        trigger.addEventListener('click', event => {
            event.stopPropagation();
            popover.hidden = !popover.hidden;
            trigger.setAttribute('aria-expanded', String(!popover.hidden));
        });
        popover.addEventListener('click', event => event.stopPropagation());
        global.document.addEventListener('click', close);
        global.document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    }

    function init() {
        initPopover();
        const countInput = global.document.getElementById('slide-count-select');
        countInput?.addEventListener('change', () => setSlideCount(countInput.value));
        global.document.getElementById('w-tema')?.addEventListener('input', updateCostPreview);
        global.document.getElementById('btn-generate')?.addEventListener('click', () => updateCostPreview());
        global.addEventListener('aedos:language-changed', () => {
            if (lastCredits) renderBalance(lastCredits);
            else updateCostPreview();
        });
        refresh();
        global.setInterval(() => refresh(), 60000);
    }

    global.AedosCreditsUI = Object.freeze({
        init,
        refresh,
        updateStatus,
        updateCostPreview,
        setSlideCount,
        getSlideCount,
        canSpend,
        getBalance: () => balance,
        getResetTime: resetTime,
        getSelectedModel: selectedModel,
        getModels: () => modelList,
        setModels(models) { modelList = models || []; updateCostPreview(); },
    });
})(window);
