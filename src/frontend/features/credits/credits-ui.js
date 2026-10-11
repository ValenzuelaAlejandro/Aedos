(function registerCreditsUi(global) {
    'use strict';

    let modelList = [];
    let balance = 50;
    let dailyLimit = 50;
    let lastCredits = null;

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

    function canAttachDocuments() {
        const chosenId = global.AedosStores?.generation?.state?.selectedModelId;
        const model = modelList.find(entry => entry.id === chosenId)
            || global.MODEL_CATALOG?.find(entry => entry.id === chosenId);
        return lastCredits?.geminiAvailable === true && model?.brand === 'gemini'
            && model.tier === 'free' && model.paid !== true;
    }

    function activeMode() {
        return global.AedosStores?.generation?.state?.proModeEnabled ? 'pro' : 'flash';
    }

    function maxSlides() {
        return global.MODE_SLIDE_LIMIT[activeMode()];
    }

    // The service owns the billing formula; this layer only enforces the current mode's slide cap.
    function getQuote(slides = getSlideCount(), model = selectedModel()) {
        const count = Math.min(maxSlides(), Math.max(1, Math.floor(Number(slides) || 1)));
        return global.AedosCredits.quote(model, count);
    }

    function getSlideCount() {
        const input = global.document?.getElementById('slide-count-select');
        const value = Number(input?.value || 8);
        return Math.min(maxSlides(), Math.max(1, Number.isFinite(value) ? value : 8));
    }

    function updateStatus(key = '', state = '', params = {}) {
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
        global.AedosAttachments?.refreshAvailability?.();
    }

    function showInsufficientStatus({ slides, billing, rate, total }) {
        const affordableSlides = billing === 'perSlide' ? Math.floor(balance / rate) : 0;
        const canReduce = affordableSlides >= 1 && affordableSlides < slides;
        updateStatus(balance <= 0 ? 'credits.exhausted'
            : (canReduce ? 'credits.insufficientSlides' : 'credits.insufficientModel'),
        balance <= 0 ? 'empty' : 'insufficient',
        { time: resetTime(), cost: total, left: balance });
        if (!canReduce) return;
        const action = global.document.createElement('button');
        action.type = 'button';
        action.className = 'credits-adjust-slides';
        action.textContent = format('credits.useSlides', { n: affordableSlides });
        action.addEventListener('click', () => setSlideCount(affordableSlides));
        global.document.getElementById('credits-status')?.append(' ', action);
    }

    // eslint-disable-next-line complexity -- Credit preview also guards incompatible attached documents.
    function updateCostPreview() {
        const { slides, billing, rate, total } = getQuote();
        const preview = global.document.getElementById('credits-cost-preview');
        const generateButton = global.document.getElementById('btn-generate');
        if (preview) {
            preview.textContent = format(total === 1 ? 'credits.costOne' : 'credits.cost', { n: total });
            preview.setAttribute('aria-label', format('credits.costAria', { n: total }));
        }
        const insufficient = total > balance;
        const blockedAttachments = global.AedosAttachments?.hasBlockingAttachments?.() === true;
        preview?.classList.toggle('is-insufficient', insufficient);
        if (insufficient) showInsufficientStatus({ slides, billing, rate, total });
        else if (global.document.getElementById('credits-status')?.dataset.state !== 'paused') {
            updateStatus('');
        }
        if (generateButton && !generateButton.classList.contains('is-generating')) {
            const hasPrompt = (global.document.getElementById('w-tema')?.value || '').trim().length >= 4;
            const hasFiles = (global._attachedFiles?.length || 0) > 0;
            generateButton.disabled = (!hasPrompt && !hasFiles) || insufficient || blockedAttachments;
            const missing = total - balance;
            const label = blockedAttachments ? global.__t('credits.attachmentsGeminiOnly') : insufficient
                ? format(missing === 1 ? 'credits.missingOne' : 'credits.missing', { n: missing })
                : global.__t('credits.generate');
            generateButton.setAttribute('aria-label', label);
            generateButton.setAttribute('data-tooltip', label);
        }
        return { slides, billing, rate, total, affordable: !insufficient && !blockedAttachments };
    }

    function setSlideCount(count) {
        const input = global.document.getElementById('slide-count-select');
        if (!input) return;
        const limit = maxSlides();
        const normalized = Math.min(limit, Math.max(1, Math.floor(Number(count) || 1)));
        input.max = String(limit);
        input.value = String(normalized);
        const triggerValue = global.document.getElementById('slide-count-value');
        const panelValue = global.document.getElementById('slide-count-panel-value');
        const maxLabel = global.document.getElementById('slide-count-max');
        if (triggerValue) triggerValue.textContent = String(normalized);
        if (panelValue) panelValue.textContent = String(normalized);
        if (maxLabel) maxLabel.textContent = String(limit);
        input.closest('.slide-count-control')?.style.setProperty('--slide-progress', `${((normalized - 1) / (limit - 1)) * 100}%`);
        input.setAttribute('aria-valuetext', `${normalized} ${global.__t('credits.slides')}`);
        global.document.getElementById('slide-count-trigger')?.setAttribute('aria-label', `${global.__t('credits.slides')}: ${normalized}`);
        updateCostPreview();
    }

    function initSlideControl() {
        const input = global.document.getElementById('slide-count-select');
        const trigger = global.document.getElementById('slide-count-trigger');
        const panel = global.document.getElementById('slide-count-panel');
        if (!input || !trigger || !panel) return;
        const close = () => { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
        const position = () => {
            if (panel.hidden) return;
            const rect = trigger.getBoundingClientRect();
            const width = panel.getBoundingClientRect().width;
            const left = Math.max(8, Math.min(rect.right - width, global.innerWidth - width - 8));
            panel.style.left = `${left - rect.left}px`;
        };
        trigger.addEventListener('click', event => {
            event.stopPropagation();
            panel.hidden = !panel.hidden;
            trigger.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) { input.focus({ preventScroll: true }); position(); }
        });
        panel.addEventListener('click', event => event.stopPropagation());
        global.document.addEventListener('click', close);
        global.document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
        global.addEventListener('resize', position);
        global.addEventListener('scroll', close, true);
        input.addEventListener('input', () => setSlideCount(input.value));
        setSlideCount(input.value);
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
            lastCredits = null;
            global.AedosAttachments?.refreshAvailability?.();
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
        initSlideControl();
        global.document.getElementById('w-tema')?.addEventListener('input', updateCostPreview);
        global.document.getElementById('btn-generate')?.addEventListener('click', () => updateCostPreview());
        global.addEventListener('aedos:language-changed', () => {
            if (lastCredits) renderBalance(lastCredits);
            else updateCostPreview();
            setSlideCount(getSlideCount());
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
        getQuote,
        canSpend,
        getBalance: () => balance,
        getResetTime: resetTime,
        getSelectedModel: selectedModel,
        canAttachDocuments,
        getModels: () => modelList,
        setModels(models) { modelList = models || []; updateCostPreview(); global.AedosAttachments?.refreshAvailability?.(); },
    });
})(window);
