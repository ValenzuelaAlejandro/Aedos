(function registerCreditsUi(global) {
    'use strict';

    const MAX_SLIDES = 15;
    let modelList = [];
    let balance = 50;

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

    function updateStatus(message = '', state = '') {
        const status = global.document?.getElementById('credits-status');
        if (!status) return;
        status.textContent = message;
        status.hidden = !message;
        status.classList.toggle('hidden', !message);
        status.dataset.state = state;
    }

    function renderBalance(credits) {
        balance = Number.isFinite(credits?.balance) ? credits.balance : 0;
        const limit = Number.isFinite(credits?.dailyLimit) ? credits.dailyLimit : 50;
        const balanceNode = global.document.getElementById('credits-balance');
        const fill = global.document.getElementById('credits-progress-fill');
        const resetNode = global.document.getElementById('credits-reset-time');
        if (balanceNode) balanceNode.textContent = `${balance} / ${limit} credits`;
        if (fill) fill.style.width = `${limit > 0 ? Math.max(0, Math.min(100, (balance / limit) * 100)) : 0}%`;
        if (resetNode) {
            const reset = credits?.resetsAt ? new Date(credits.resetsAt) : global.AedosCredits.nextLocalReset();
            resetNode.textContent = reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        }
        updateCostPreview();
    }

    function updateCostPreview() {
        const model = selectedModel();
        const slides = getSlideCount();
        const rate = model?.creditsPerSlide || 3;
        const total = slides * rate;
        const preview = global.document.getElementById('credits-cost-preview');
        const generateButton = global.document.getElementById('btn-generate');
        if (preview) preview.textContent = `${slides} slides × ${rate} = ${total} credits`;
        const affordableSlides = Math.floor(balance / rate);
        const insufficient = total > balance;
        if (insufficient) {
            updateStatus(balance <= 0
                ? `Credits used up for today. They reset at ${global.document.getElementById('credits-reset-time')?.textContent || 'midnight'}.`
                : `Not enough credits. You can generate up to ${Math.min(MAX_SLIDES, affordableSlides)} slides with this model.`,
            balance <= 0 ? 'empty' : 'insufficient');
        } else if (global.document.getElementById('credits-status')?.dataset.state !== 'paused') {
            updateStatus('');
        }
        if (generateButton && !generateButton.classList.contains('is-generating')) {
            const hasPrompt = (global.document.getElementById('w-tema')?.value || '').trim().length >= 4;
            generateButton.disabled = !hasPrompt || insufficient;
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
            updateStatus(balance <= 0 ? 'Credits used up for today.' : 'Not enough credits for this action.', balance <= 0 ? 'empty' : 'insufficient');
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
            updateStatus('Credits are temporarily unavailable. Try again shortly.', 'error');
            return null;
        }
    }

    function init() {
        const countInput = global.document.getElementById('slide-count-select');
        countInput?.addEventListener('change', () => setSlideCount(countInput.value));
        global.document.getElementById('w-tema')?.addEventListener('input', updateCostPreview);
        global.document.getElementById('btn-generate')?.addEventListener('click', () => updateCostPreview());
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
        getSelectedModel: selectedModel,
        getModels: () => modelList,
        setModels(models) { modelList = models || []; updateCostPreview(); },
    });
})(window);
