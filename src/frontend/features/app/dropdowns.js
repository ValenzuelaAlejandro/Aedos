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
            modelBtn, modelMenu, modelOptions, modeButtons, langBtn, langMenu, exportMenuBtn, exportMenu,
            exportPptxBtn, currentModelLabel, currentModelIcon, currentLangLabel, chatInputWrapper,
        } = elements;

        function closeAllDropdowns() {
            if (modelMenu) modelMenu.classList.add('hidden');
            if (langMenu) langMenu.classList.add('hidden');
            if (exportMenu) exportMenu.classList.add('hidden');
            if (modelBtn) modelBtn.setAttribute('aria-expanded', 'false');
            if (langBtn) langBtn.setAttribute('aria-expanded', 'false');
            if (exportMenuBtn) exportMenuBtn.setAttribute('aria-expanded', 'false');
        }

        const creditsUI = window.AedosCreditsUI;
        const brands = new Set(['gemini', 'openai', 'anthropic', 'nvidia', 'dotsstudio']);
        let paymentsPaused = false;
        function brandFor(model) {
            if (brands.has(model.brand)) return model.brand;
            const id = model.id || '';
            if (id.startsWith('google/')) return 'gemini';
            if (id.startsWith('openai/')) return 'openai';
            if (id.startsWith('anthropic/')) return 'anthropic';
            if (id.startsWith('nvidia/')) return 'nvidia';
            if (id.startsWith('dots-studio/')) return 'dotsstudio';
            return 'avatar';
        }
        function renderBrandIcon(element, model) {
            const brand = brandFor(model);
            element.className = `model-brand-icon model-brand-icon--${brand}`;
            element.textContent = brand === 'avatar' ? (model.name || 'A').charAt(0).toUpperCase() : '';
        }
        function selectModel(model) {
            generationState.selectedModelId = model.id;
            if (currentModelLabel) currentModelLabel.textContent = model.name;
            if (currentModelIcon) renderBrandIcon(currentModelIcon, model);
            if (modelBtn) modelBtn.setAttribute('aria-label', window.__t('credits.selectModel').replace('{model}', model.name));
            creditsUI?.updateCostPreview();
        }
        function renderModels(models, paused) {
            if (!modelOptions) return;
            paymentsPaused = paused;
            modelOptions.replaceChildren();
            if (creditsUI) creditsUI.setModels(models);
            const visibleModels = models.filter(model => !paused || model.tier === 'free');
            ['free', 'light', 'standard'].forEach(tier => {
                const tierModels = models.filter(model => model.tier === tier);
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
                    const unavailable = paused && model.tier !== 'free';
                    if (unavailable) {
                        option.dataset.paused = 'true';
                        option.setAttribute('aria-disabled', 'true');
                        option.setAttribute('data-tooltip', window.__t('credits.modelUnavailable'));
                        option.tabIndex = -1;
                    }
                    const icon = document.createElement('span'); renderBrandIcon(icon, model); icon.setAttribute('aria-hidden', 'true');
                    const name = document.createElement('span'); name.className = 'model-option-name'; name.textContent = model.name;
                    const cost = document.createElement('span'); cost.className = 'model-option-cost'; cost.textContent = window.__t('credits.perSlide').replace('{n}', creditsUI.getQuote(1, model).rate);
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
                if (item.dataset.paused === 'true') return;
                const model = (creditsUI?.getModels() || window.MODEL_CATALOG || []).find(entry => entry.id === item.dataset.modelId);
                if (!model) return;
                selectModel(model);
                modelMenu.querySelectorAll('.model-dropdown-item').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-checked', 'false'); });
                item.classList.add('active');
                item.setAttribute('aria-checked', 'true');
                closeAllDropdowns();
            });
        }
        modeButtons?.forEach(button => button.addEventListener('click', () => {
            generationState.proModeEnabled = button.dataset.generationMode === 'pro';
            modeButtons.forEach(el => { const active = el === button; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); });
            chatInputWrapper?.classList.toggle('is-pro', generationState.proModeEnabled);
            creditsUI?.setSlideCount(creditsUI.getSlideCount());
            renderModels(creditsUI?.getModels() || window.MODEL_CATALOG || [], paymentsPaused);
        }));
        if (creditsUI) creditsUI.refresh().then(result => {
            if (result) renderModels(result.models, result.paymentsPaused);
        });
        window.addEventListener('aedos:models-updated', event => {
            const detail = event.detail || {};
            renderModels(detail.models || [], Boolean(detail.paymentsPaused));
        });
        window.addEventListener('aedos:language-changed', () => {
            renderModels(creditsUI?.getModels() || window.MODEL_CATALOG || [], paymentsPaused);
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
        // Document attachments are disabled in this frontend.
        window._syncModeWithFiles = function () {
            window._attachedFiles = [];
        };
    }

    api.createAppDropdowns = createAppDropdowns;
})(typeof window !== 'undefined' ? window : globalThis);
