(function registerAedosAppDropdowns(root) {
    const api = root.AedosAppDropdowns || (root.AedosAppDropdowns = {});

    /**
     * @typedef {Object} AppDropdownDependencies
     * @property {Document} document
     * @property {Window} window
     * @property {Object} generationState
     * @property {Object} elements
     * @property {HTMLElement|null} elements.modeBtn
     * @property {HTMLElement|null} elements.modeMenu
     * @property {HTMLElement|null} elements.langBtn
     * @property {HTMLElement|null} elements.langMenu
     * @property {HTMLElement|null} elements.exportMenuBtn
     * @property {HTMLElement|null} elements.exportMenu
     * @property {HTMLElement|null} elements.exportPptxBtn
     * @property {HTMLElement|null} elements.currentModeLabel
     * @property {HTMLElement|null} elements.currentLangLabel
     * @property {HTMLElement|null} elements.chatInputWrapper
     * @property {HTMLElement|null} finalizeBtn
     */

    /** Bind mode, language and export dropdowns using the existing shared state. */
    // eslint-disable-next-line max-lines-per-function -- Keep this vertical controller in legacy registration order.
    function createAppDropdowns({ document, window, generationState, elements, finalizeBtn }) {
        const {
            modelBtn, modelMenu, modelOptions, modeToggle, langBtn, langMenu, exportMenuBtn, exportMenu,
            exportPptxBtn, currentModelLabel, currentModelIcon, currentLangLabel, chatInputWrapper,
        } = elements;

        function closeAllDropdowns() {
            if (modelMenu) modelMenu.classList.add('hidden');
            if (langMenu) langMenu.classList.add('hidden');
            if (exportMenu) exportMenu.classList.add('hidden');
            if (modelBtn) modelBtn.setAttribute('aria-expanded', 'false');
            if (langBtn) langBtn.setAttribute('aria-expanded', 'false');
            if (exportMenuBtn) exportMenuBtn.setAttribute('aria-expanded', 'false');
            const slidePanel = document.getElementById('slide-count-panel');
            if (slidePanel) slidePanel.hidden = true;
            document.getElementById('slide-count-trigger')?.setAttribute('aria-expanded', 'false');
            const balancePopover = document.getElementById('credits-popover');
            if (balancePopover) balancePopover.hidden = true;
            document.getElementById('credits-balance-trigger')?.setAttribute('aria-expanded', 'false');
        }

        const creditsUI = window.AedosCreditsUI;
        const brands = new Set(['gemini', 'openai', 'anthropic', 'nvidia']);
        let paymentsPaused = false;
        function brandFor(model) {
            if (brands.has(model.brand)) return model.brand;
            const id = model.id || '';
            if (id.startsWith('google/')) return 'gemini';
            if (id.startsWith('openai/')) return 'openai';
            if (id.startsWith('anthropic/')) return 'anthropic';
            if (id.startsWith('nvidia/')) return 'nvidia';
            return 'avatar';
        }
        function renderBrandIcon(element, model) {
            const brand = brandFor(model);
            element.className = `model-brand-icon model-brand-icon--${brand}`;
            element.textContent = brand === 'avatar' ? (model.name || 'A').charAt(0).toUpperCase() : '';
        }
        function selectModel(model) {
            const previousSlides = creditsUI?.getSlideCount() || 1;
            generationState.selectedModelId = model.id;
            if (currentModelLabel) currentModelLabel.textContent = model.name;
            if (currentModelIcon) renderBrandIcon(currentModelIcon, model);
            if (modelBtn) modelBtn.setAttribute('aria-label', window.__t('credits.selectModel').replace('{model}', model.name));
            creditsUI?.setSlideCount(previousSlides);
            const newSlides = creditsUI?.getSlideCount() || previousSlides;
            if (newSlides < previousSlides) creditsUI?.showModeClampNotice(newSlides, model.name);
            window.AedosAttachments?.refreshAvailability?.();
        }
        function renderModels(models, paused) {
            if (!modelOptions) return;
            paymentsPaused = paused;
            modelOptions.replaceChildren();
            if (creditsUI) creditsUI.setModels(models);
            const visibleModels = models.filter(model => !paused || model.tier === 'free');
            ['free', 'light', 'standard'].forEach(tier => {
                const tierModels = visibleModels.filter(model => model.tier === tier);
                if (!tierModels.length) return;
                const heading = document.createElement('div');
                heading.className = 'model-tier-heading';
                heading.textContent = window.__t(`tier.${tier}`);
                modelOptions.appendChild(heading);
                tierModels.forEach(model => {
                    const option = document.createElement('button');
                    option.type = 'button';
                    option.className = 'dropdown-item model-dropdown-item';
                    option.dataset.modelId = model.id;
                    option.setAttribute('role', 'menuitemradio');
                    option.setAttribute('aria-checked', String(model.id === generationState.selectedModelId));
                    const icon = document.createElement('span'); renderBrandIcon(icon, model); icon.setAttribute('aria-hidden', 'true');
                    const name = document.createElement('span'); name.className = 'model-option-name';
                    name.textContent = model.name;
                    const quote = creditsUI.getQuote(1, model);
                    const costKey = quote.billing === 'perPresentation'
                        ? (quote.rate === 1 ? 'credits.perPresentationOne' : 'credits.perPresentationMany')
                        : (quote.rate === 1 ? 'credits.perSlideOne' : 'credits.perSlideMany');
                    const cost = document.createElement('span'); cost.className = 'model-option-cost'; cost.textContent = window.__t(costKey).replace('{n}', quote.rate);
                    option.append(icon, name, cost);
                    if (model.id === generationState.selectedModelId) option.classList.add('active');
                    modelOptions.appendChild(option);
                });
            });
            const pausedMessage = document.getElementById('model-payment-paused-message');
            pausedMessage?.classList.toggle('hidden', !paused);
            if (pausedMessage) pausedMessage.textContent = window.__t('credits.paidPaused');
            if (paused) creditsUI?.updateStatus('credits.paidPaused', 'paused');
            else if (document.getElementById('credits-status')?.dataset.state === 'paused') creditsUI?.updateStatus('');
            if (!visibleModels.some(model => model.id === generationState.selectedModelId) && visibleModels[0]) selectModel(visibleModels[0]);
            else {
                const selected = visibleModels.find(model => model.id === generationState.selectedModelId);
                if (selected) selectModel(selected);
            }
        }
        if (modelBtn && modelMenu) {
            modelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = modelMenu.classList.contains('hidden');
                closeAllDropdowns();
                if (isHidden) {
                    modelMenu.classList.remove('hidden');
                    modelBtn.setAttribute('aria-expanded', 'true');
                }
            });
            modelMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.model-dropdown-item[data-model-id]');
                if (!item) return;
                const model = (creditsUI?.getModels() || window.MODEL_CATALOG || []).find(entry => entry.id === item.dataset.modelId);
                if (!model) return;
                selectModel(model);
                modelMenu.querySelectorAll('.model-dropdown-item').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-checked', 'false'); });
                item.classList.add('active');
                item.setAttribute('aria-checked', 'true');
                closeAllDropdowns();
            });
        }
        function renderModeToggle() {
            if (!modeToggle) return;
            modeToggle.setAttribute('aria-checked', String(generationState.proModeEnabled));
            const tip = window.__t(generationState.proModeEnabled ? 'mode.tooltipPro' : 'mode.tooltipFlash');
            modeToggle.setAttribute('data-tooltip', tip);
            modeToggle.title = tip;
        }
        modeToggle?.addEventListener('click', () => {
            const oldCount = creditsUI?.getSlideCount() || 1;
            generationState.proModeEnabled = !generationState.proModeEnabled;
            renderModeToggle();
            chatInputWrapper?.classList.toggle('is-pro', generationState.proModeEnabled);
            creditsUI?.setSlideCount(oldCount);
            if (generationState.proModeEnabled && oldCount > window.MAX_SLIDES_BY_MODE.pro) {
                creditsUI?.showModeClampNotice(window.MAX_SLIDES_BY_MODE.pro);
            }
            renderModels(creditsUI?.getModels() || window.MODEL_CATALOG || [], paymentsPaused);
        });
        renderModeToggle();
        if (creditsUI) creditsUI.refresh().then(result => {
            if (result) renderModels(result.models, result.paymentsPaused);
        });
        window.addEventListener('aedos:models-updated', event => {
            const detail = event.detail || {};
            renderModels(detail.models || [], Boolean(detail.paymentsPaused));
        });
        window.addEventListener('aedos:language-changed', () => {
            renderModels(creditsUI?.getModels() || window.MODEL_CATALOG || [], paymentsPaused);
            renderModeToggle();
        });

        if (langBtn && langMenu) {
            langBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = langMenu.classList.contains('hidden');
                closeAllDropdowns();
                if (isHidden) {
                    langMenu.classList.remove('hidden');
                    langBtn.setAttribute('aria-expanded', 'true');
                }
            });
            langMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.dropdown-item[data-lang]');
                if (!item) return;
                generationState.targetLanguage = item.dataset.lang;
                if (item.dataset.lang === 'es' || item.dataset.lang === 'en') window.__setUiLanguage?.(item.dataset.lang);
                langMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                if (currentLangLabel) currentLangLabel.textContent = item.textContent.split(' ')[0]; // Show shortened name if space exists
                closeAllDropdowns();
            });
        }

        if (exportMenuBtn && exportMenu) {
            exportMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = exportMenu.classList.contains('hidden');
                closeAllDropdowns();
                if (isHidden) {
                    exportMenu.classList.remove('hidden');
                    exportMenuBtn.setAttribute('aria-expanded', 'true');
                }
            });
            exportMenu.addEventListener('click', (e) => {
                if (e.target.closest('#finalize-btn')) closeAllDropdowns();
            });
            if (exportPptxBtn) {
                exportPptxBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (finalizeBtn && finalizeBtn.disabled) return;
                    generationState.requestedExportFormat = 'pptx';
                    closeAllDropdowns();
                    finalizeBtn?.click();
                });
            }
        }

        document.addEventListener('click', closeAllDropdowns);

        renderModels(window.MODEL_CATALOG || [], false);
    }

    api.createAppDropdowns = createAppDropdowns;
})(typeof window !== 'undefined' ? window : globalThis);
