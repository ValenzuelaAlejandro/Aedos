(function registerCreditsUi(global) {
    'use strict';

    let modelList = [];
    let balance = 50000;
    let dailyLimit = 50000;
    let lastCredits = null;
    let creditsAvailable = false;
    let creditsPhase = 'loading';
    let refreshRunner = null;
    let clampNoticeCount = null;
    let clampNoticeModel = null;
    let clampNoticeTimer = null;
    let slideLimitAttempted = false;
    let spendPaused = false;

    function nextUtcReset() {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    }

    function format(key, params = {}) {
        return global.__t(key).replace(/\{([a-z]+)\}/g, (match, name) =>
            Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
    }

    const percent = units => global.AedosCredits.percent(units, dailyLimit);

    function resetTime() {
        const candidate = lastCredits?.resetsAt ? new Date(lastCredits.resetsAt) : nextUtcReset();
        const reset = Number.isNaN(candidate.getTime()) ? nextUtcReset() : candidate;
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

    function maxSlides(model = selectedModel()) {
        const mode = activeMode();
        const modeLimit = global.MAX_SLIDES_BY_MODE[mode];
        const modelLimit = Number(model?.maxSlides?.[mode]);
        return Number.isSafeInteger(modelLimit) && modelLimit > 0
            ? Math.min(modeLimit, modelLimit) : modeLimit;
    }

    function absoluteMaxSlides() {
        return Math.max(...Object.values(global.MAX_SLIDES_BY_MODE));
    }

    function affordableMaxSlides() {
        const quote = global.AedosCredits.quote(selectedModel(), 1, activeMode());
        return quote.billing === 'perSlide' ? Math.min(maxSlides(), Math.floor(balance / quote.rate)) : maxSlides();
    }

    // The service owns the billing formula; this layer only enforces the current mode's slide cap.
    function getQuote(slides = getSlideCount(), model = selectedModel()) {
        if (global.AedosConversation?.isActive()) return global.AedosCredits.quoteChat(model, activeMode());
        const count = Math.min(maxSlides(model), Math.max(1, Math.floor(Number(slides) || 1)));
        return global.AedosCredits.quote(model, count, activeMode());
    }

    function getSlideCount() {
        const input = global.document?.getElementById('slide-count-select');
        const value = Number(input?.value || 8);
        return Math.min(maxSlides(), Math.max(1, Number.isFinite(value) ? value : 8));
    }

    function updateStatus(key = '', state = '', params = {}) {
        if (!creditsAvailable) { key = creditsPhase === 'loading' ? 'credits.loading' : 'credits.unavailable'; state = 'loading'; }
        const status = global.document?.getElementById('credits-status');
        if (!status) return;
        status.textContent = key ? format(key, params) : '';
        status.hidden = !key;
        status.classList.toggle('hidden', !key);
        status.dataset.state = state;
    }

    // eslint-disable-next-line complexity -- The ready balance synchronizes the chip, meter, slide quote and attachments.
    function renderBalance(credits) {
        lastCredits = credits;
        creditsAvailable = true;
        creditsPhase = 'ready';
        balance = Number.isFinite(credits?.balance) ? credits.balance : 0;
        dailyLimit = Number.isFinite(credits?.dailyLimit) ? credits.dailyLimit : 50000;
        spendPaused = credits?.spendPaused === true;
        const balanceNode = global.document.getElementById('credits-balance');
        const popoverBalance = global.document.getElementById('credits-popover-balance');
        const trigger = global.document.getElementById('credits-balance-trigger');
        if (trigger) { trigger.setAttribute('aria-busy', 'false'); trigger.dataset.state = 'ready'; }
        const progress = global.document.querySelector('.credits-progress[role="meter"]');
        const fill = global.document.getElementById('credits-progress-fill');
        const resetNode = global.document.getElementById('credits-reset-time');
        const remaining = percent(balance), count = format('credits.chip', { remaining });
        const percentNode = global.document.getElementById('credits-balance-percent');
        if (percentNode) percentNode.textContent = remaining;
        else if (balanceNode) balanceNode.textContent = count;
        if (popoverBalance) popoverBalance.textContent = count;
        if (trigger) trigger.setAttribute('aria-label', format('credits.balanceAria', { remaining }));
        const ratio = dailyLimit > 0 ? Math.max(0, Math.min(1, balance / dailyLimit)) : 0;
        global.document.querySelectorAll('.credits-ring').forEach(ring => {
            ring.style.setProperty('--ring-offset', String(2 * Math.PI * 8 * (1 - ratio)));
            ring.dataset.state = ratio === 0 ? 'empty' : ratio < 0.2 ? 'low' : 'normal';
        });
        if (fill) fill.style.width = `${dailyLimit > 0 ? Math.max(0, Math.min(100, (balance / dailyLimit) * 100)) : 0}%`;
        if (progress) {
            progress.setAttribute('aria-valuemax', '100');
            progress.setAttribute('aria-valuenow', String(Math.floor(ratio * 100)));
        }
        if (resetNode) resetNode.textContent = format('credits.resetsAt', { time: resetTime() });
        setSlideCount(getSlideCount());
        global.AedosAttachments?.refreshAvailability?.();
    }

    function renderBalanceUnavailable(phase = creditsPhase) {
        const unavailable = global.__t('credits.balanceUnavailable');
        const balanceNode = global.document.getElementById('credits-balance');
        const popoverBalance = global.document.getElementById('credits-popover-balance');
        const trigger = global.document.getElementById('credits-balance-trigger');
        creditsAvailable = false;
        creditsPhase = phase;
        if (trigger) { trigger.setAttribute('aria-busy', 'true'); trigger.dataset.state = phase; }
        const percentNode = global.document.getElementById('credits-balance-percent');
        if (percentNode) percentNode.textContent = '—'; else if (balanceNode) balanceNode.textContent = '—';
        if (popoverBalance) popoverBalance.textContent = unavailable;
        if (trigger) trigger.setAttribute('aria-label', unavailable);
        global.document.querySelectorAll('.credits-ring').forEach(ring => {
            ring.style.setProperty('--ring-offset', '0');
            ring.dataset.state = 'unavailable';
        });
        const progress = global.document.querySelector('.credits-progress[role="meter"]');
        if (progress) progress.setAttribute('aria-valuenow', '0');
        updateCostPreview();
    }

    function showInsufficientStatus({ slides, billing, rate, total }) {
        const affordableSlides = billing === 'perSlide' ? Math.floor(balance / rate) : 0;
        const canReduce = affordableSlides >= 1 && affordableSlides < slides;
        updateStatus(balance <= 0 ? 'credits.exhausted'
            : (canReduce ? 'credits.insufficientSlides' : 'credits.insufficientModel'),
        balance <= 0 ? 'empty' : 'insufficient',
        { time: resetTime(), cost: percent(total), left: percent(balance) });
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
            preview.textContent = format(billing === 'chat' ? 'credits.chatReserve' : 'credits.cost', { n: percent(total) });
            preview.setAttribute('aria-label', format('credits.costAria', { n: percent(total) }));
        }
        const liveCost = global.document.getElementById('slide-count-live-cost');
        if (liveCost) {
            liveCost.textContent = format('credits.cost', { n: percent(total) });
            liveCost.classList.toggle('is-insufficient', total > balance);
        }
        const insufficient = total > balance;
        const blockedAttachments = global.AedosAttachments?.hasBlockingAttachments?.() === true;
        preview?.classList.toggle('is-insufficient', insufficient);
        if (spendPaused) updateStatus('credits.spendPaused', 'paused');
        else if (insufficient && billing === 'chat') updateStatus('credits.chatInsufficient', 'insufficient', { left: percent(balance), n: percent(total) });
        else if (insufficient) showInsufficientStatus({ slides, billing, rate, total });
        else if (global.document.getElementById('credits-status')?.dataset.state !== 'paused') {
            updateStatus('');
        }
        if (generateButton && !generateButton.classList.contains('is-generating')) {
            const hasPrompt = (global.document.getElementById('w-tema')?.value || '').trim().length >= 4;
            const hasFiles = (global._attachedFiles?.length || 0) > 0;
            generateButton.disabled = !creditsAvailable || (!hasPrompt && !hasFiles) || insufficient || blockedAttachments || spendPaused;
            const missing = total - balance;
            const label = spendPaused ? global.__t('credits.spendPaused')
                : !creditsAvailable ? global.__t('credits.balanceUnavailable')
                : blockedAttachments ? global.__t('credits.attachmentsGeminiOnly') : insufficient
                ? format('credits.missing', { n: percent(missing) })
                : global.__t('credits.generate');
            generateButton.setAttribute('aria-label', label);
            generateButton.setAttribute('data-tooltip', label);
        }
        return { slides, billing, rate, total, affordable: creditsAvailable && !insufficient && !blockedAttachments && !spendPaused };
    }

    function renderSlideValue(input, normalized, limit) {
        const unit = format(normalized === 1 ? 'slides.unitOne' : 'slides.unitMany', { n: normalized });
        const zone = global.getSlideZones(limit).find(entry => normalized >= entry.start && normalized <= entry.end);
        const zoneLabel = zone ? global.__t(`slides.zone.${zone.key}`) : '';
        const panelValue = global.document.getElementById('slide-count-panel-value');
        const unitNode = global.document.getElementById('slide-count-unit');
        const zoneNode = global.document.getElementById('slide-count-zone');
        const triggerValue = global.document.getElementById('slide-count-value');
        if (triggerValue) triggerValue.textContent = String(normalized);
        if (panelValue) panelValue.textContent = String(normalized);
        if (unitNode) unitNode.textContent = unit.replace(String(normalized), '').trim();
        if (zoneNode) { zoneNode.textContent = zoneLabel; zoneNode.dataset.zone = zone?.key || ''; }
        if (panelValue && !global.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            panelValue.classList.remove('slide-count-pop');
            void panelValue.offsetWidth;
            panelValue.classList.add('slide-count-pop');
        }
        const spokenZone = zoneLabel.toLocaleLowerCase(global.currentLang === 'es' ? 'es' : 'en');
        input.setAttribute('aria-valuetext', zone ? format('slides.valueText', { slides: unit, zone: spokenZone }) : unit);
        global.document.getElementById('slide-count-trigger')?.setAttribute('aria-label', `${global.__t('slides.ariaLabel')}: ${unit}`);
    }

    function setSlideCount(count) {
        const input = global.document.getElementById('slide-count-select');
        if (!input) return;
        if (maxSlides() === absoluteMaxSlides()) {
            const hint = global.document.getElementById('slide-count-limit-hint');
            if (hint) hint.hidden = true;
            slideLimitAttempted = false;
        }
        const limit = maxSlides();
        const affordable = affordableMaxSlides();
        const effective = Math.max(1, affordable);
        const normalized = Math.min(effective, Math.max(1, Math.floor(Number(count) || 1)));
        input.max = String(effective);
        input.disabled = affordable < 1;
        input.value = String(normalized);
        const wrapper = input.closest('.slide-count-control');
        wrapper?.style.setProperty('--tick-count', String(limit));
        wrapper?.style.setProperty('--n-size', `${32 + 24 * ((normalized - 1) / Math.max(1, limit - 1))}px`);
        const trackWidth = input.parentElement?.clientWidth || 0;
        if (trackWidth > 0) {
            const tickWidth = trackWidth / limit;
            wrapper?.style.setProperty('--rail-start', `${tickWidth / 2}px`);
            wrapper?.style.setProperty('--rail-length', `${(limit - 1) * tickWidth}px`);
            wrapper?.style.setProperty('--rail-fill', `${(normalized - 1) * tickWidth}px`);
            input.style.left = `${trackWidth / (limit * 2) - 12}px`;
            input.style.width = `${24 + (effective - 1) * tickWidth}px`;
        }
        renderSlideValue(input, normalized, limit);
        global.AedosCreditsSlideView.renderTicks(limit, affordable, normalized);
        updateCostPreview();
    }

    function showModeClampNotice(count, model = null) {
        const notice = global.document.getElementById('slide-count-mode-notice');
        if (!notice) return;
        clampNoticeCount = count;
        clampNoticeModel = model;
        notice.textContent = model && model !== 'flash' && model !== 'pro'
            ? format('slides.modelClamped', { model, n: count })
            : format(model === 'flash' ? 'slides.flashClamped' : 'slides.proClamped', { n: count });
        notice.hidden = false;
        global.clearTimeout(clampNoticeTimer);
        clampNoticeTimer = global.setTimeout(() => { notice.hidden = true; clampNoticeCount = null; clampNoticeModel = null; }, 4500);
    }

    function initSlideControl() {
        const input = global.document.getElementById('slide-count-select');
        const trigger = global.document.getElementById('slide-count-trigger');
        const panel = global.document.getElementById('slide-count-panel');
        if (!input || !trigger || !panel) return;
        const limitHint = global.document.getElementById('slide-count-limit-hint');
        const showLimitHint = () => {
            if (maxSlides() >= absoluteMaxSlides() || !limitHint) return;
            slideLimitAttempted = true;
            limitHint.textContent = activeMode() === 'pro'
                ? format('slides.proLimitHint', { n: maxSlides() })
                : format('slides.modelLimitHint', { model: selectedModel()?.name || '', n: maxSlides() });
            limitHint.hidden = false;
        };
        const close = () => {
            panel.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            if (limitHint) limitHint.hidden = true;
            slideLimitAttempted = false;
        };
        const position = () => {
            if (panel.hidden) return;
            const rect = trigger.getBoundingClientRect();
            const width = panel.getBoundingClientRect().width;
            const left = Math.max(8, Math.min(rect.right - width, global.innerWidth - width - 8));
            panel.style.left = `${left - rect.left}px`;
        };
        trigger.addEventListener('click', event => {
            event.stopPropagation();
            global.document.querySelectorAll('.dropdown-menu').forEach(menu => menu.classList.add('hidden'));
            global.document.querySelectorAll('.dropdown-container > button[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', 'false'));
            const balancePopover = global.document.getElementById('credits-popover');
            if (balancePopover) balancePopover.hidden = true;
            global.document.getElementById('credits-balance-trigger')?.setAttribute('aria-expanded', 'false');
            panel.hidden = !panel.hidden;
            trigger.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) { setSlideCount(input.value); input.focus({ preventScroll: true }); position(); }
        });
        panel.addEventListener('click', event => event.stopPropagation());
        const track = input.parentElement;
        const beyondSlideLimit = event => {
            if (maxSlides() >= absoluteMaxSlides() || !track) return false;
            const rect = track.getBoundingClientRect();
            return event.clientX > rect.left + (maxSlides() - .5) * rect.width / maxSlides();
        };
        let dragging = false;
        track?.addEventListener('pointerdown', event => {
            dragging = true;
            if (beyondSlideLimit(event)) showLimitHint();
        });
        global.document.addEventListener('pointermove', event => {
            if (dragging && beyondSlideLimit(event)) showLimitHint();
        });
        global.document.addEventListener('pointerup', () => { dragging = false; });
        global.document.addEventListener('pointercancel', () => { dragging = false; });
        global.document.addEventListener('click', close);
        global.document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
        global.addEventListener('resize', () => { setSlideCount(input.value); position(); });
        global.addEventListener('scroll', close, true);
        let previousStep = Number(input.value);
        input.addEventListener('input', () => {
            const step = Number(input.value);
            if (step !== previousStep && !global.matchMedia?.('(prefers-reduced-motion: reduce)').matches) global.navigator?.vibrate?.(5);
            previousStep = step;
            setSlideCount(step);
        });
        input.addEventListener('change', () => {
            global.document.getElementById('slide-count-announce').textContent = input.getAttribute('aria-valuetext');
        });
        input.addEventListener('keydown', event => {
            if (maxSlides() < absoluteMaxSlides() && Number(input.value) >= maxSlides()
                && ['ArrowRight', 'ArrowUp', 'PageUp', 'End'].includes(event.key)) showLimitHint();
            if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
            event.preventDefault();
            setSlideCount(Number(input.value) + (event.key === 'PageUp' ? 5 : -5));
            global.document.getElementById('slide-count-announce').textContent = input.getAttribute('aria-valuetext');
        });
        setSlideCount(input.value);
    }

    function canSpend(amount) {
        if (balance < amount) {
            const missing = amount - balance;
            updateStatus(balance <= 0 ? 'credits.exhausted' : 'credits.missing',
                balance <= 0 ? 'empty' : 'insufficient', { time: resetTime(), n: percent(missing) });
            return false;
        }
        return true;
    }

    async function refresh() {
        if (!global.AedosCredits) return;
        if (!refreshRunner) refreshRunner = global.AedosCredits.createRefresher({
            onCredits: credits => renderBalance(credits),
            onModels: modelsResult => {
                modelList = modelsResult.models || [];
                global.dispatchEvent?.(new global.CustomEvent('aedos:models-updated', { detail: { models: modelList, paymentsPaused: modelsResult.paymentsPaused } }));
            },
            onSuccess: (credits, modelsResult) => {
                return { credits, models: modelList, paymentsPaused: modelsResult.paymentsPaused };
            },
            onUnavailable: () => {
                renderBalanceUnavailable('retrying');
                updateStatus('credits.unavailable', 'loading');
            },
        });
        return refreshRunner();
    }

    function init() {
        global.AedosCreditsPopover?.init();
        initSlideControl();
        global.document.getElementById('w-tema')?.addEventListener('input', updateCostPreview);
        global.document.getElementById('btn-generate')?.addEventListener('click', () => updateCostPreview());
        global.addEventListener('aedos:language-changed', () => {
            if (lastCredits && creditsAvailable) renderBalance(lastCredits);
            else updateCostPreview();
            setSlideCount(getSlideCount());
            if (clampNoticeCount !== null) {
                showModeClampNotice(clampNoticeCount, clampNoticeModel);
            }
            if (slideLimitAttempted) {
                const hint = global.document.getElementById('slide-count-limit-hint');
                if (hint) hint.textContent = activeMode() === 'pro'
                    ? format('slides.proLimitHint', { n: maxSlides() })
                    : format('slides.modelLimitHint', { model: selectedModel()?.name || '', n: maxSlides() });
            }
        });
        global.addEventListener('aedos:conversation-lock-changed', updateCostPreview);
        renderBalanceUnavailable();
        updateStatus('credits.unavailable', 'error');
        refresh();
        global.setInterval(() => refresh(), 60000);
    }

    global.AedosCreditsUI = Object.freeze({
        init,
        refresh,
        updateStatus,
        updateCostPreview,
        setSlideCount,
        showModeClampNotice,
        getSlideCount,
        getQuote,
        canSpend,
        getBalance: () => balance,
        getRemainingPercent: () => percent(balance),
        getResetTime: resetTime,
        getSelectedModel: selectedModel,
        canAttachDocuments,
        getModels: () => modelList,
        setModels(models) { modelList = models || []; updateCostPreview(); global.AedosAttachments?.refreshAvailability?.(); },
    });
})(window);
