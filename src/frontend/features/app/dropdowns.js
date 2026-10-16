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
        const modelAnchor = document.createComment('model menu');
        modelMenu?.before(modelAnchor);
        const modelBackdrop = document.getElementById('model-sheet-backdrop');

        function closeModelSheet() {
            if (modelMenu) modelMenu.classList.add('hidden');
            if (modelBackdrop) modelBackdrop.hidden = true;
            modelMenu?.classList.remove('mobile-settings-panel', 'is-open');
            modelMenu?.setAttribute('role', 'menu');
            modelMenu?.removeAttribute('aria-modal');
            if (modelMenu) modelMenu.style.left = '';
            if (modelAnchor.parentNode && modelMenu) modelAnchor.after(modelMenu);
            document.documentElement.classList.remove('model-sheet-open');
            document.body.classList.remove('model-sheet-open');
        }

        function closeAllDropdowns() {
            closeModelSheet();
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
        const newConversationBtn = document.getElementById('new-conversation-btn');
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
            const visibleModels = models.filter(model => !paused || model.tier === 'free' || model.id === generationState.selectedModelId);
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
                    option.dataset.paid = String(model.paid === true);
                    option.disabled = paused && model.paid === true;
                    option.setAttribute('role', 'menuitemradio');
                    option.setAttribute('aria-checked', String(model.id === generationState.selectedModelId));
                    const icon = document.createElement('span'); renderBrandIcon(icon, model); icon.setAttribute('aria-hidden', 'true');
                    const name = document.createElement('span'); name.className = 'model-option-name';
                    name.textContent = model.name;
                    const quote = creditsUI.getQuote(1, model);
                    const cost = document.createElement('span'); cost.className = 'model-option-cost';
                    cost.textContent = window.__t('credits.perSlideMany').replace('{n}', String(quote.ratePercent));
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
            {
                const selected = visibleModels.find(model => model.id === generationState.selectedModelId);
                if (selected) selectModel(selected);
            }
            setConversationLock(window.AedosConversation?.isActive?.() === true);
        }
        if (modelBtn && modelMenu) {
            modelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = modelMenu.classList.contains('hidden');
                closeAllDropdowns();
                if (isHidden) {
                    if (window.matchMedia('(max-width: 480px)').matches) {
                        document.getElementById('mobile-settings-close')?.click();
                        document.body.append(modelBackdrop, modelMenu);
                        modelMenu.classList.add('mobile-settings-panel', 'is-open');
                        modelMenu.setAttribute('role', 'dialog');
                        modelMenu.setAttribute('aria-modal', 'true');
                        modelMenu.setAttribute('aria-labelledby', 'model-sheet-title');
                        document.getElementById('model-sheet-title').textContent = modelBtn.getAttribute('aria-label');
                        if (modelBackdrop) modelBackdrop.hidden = false;
                        document.documentElement.classList.add('model-sheet-open');
                        document.body.classList.add('model-sheet-open');
                    }
                    modelMenu.classList.remove('hidden');
                    modelBtn.setAttribute('aria-expanded', 'true');
                    if (window.matchMedia('(max-width: 480px)').matches) {
                        document.getElementById('model-sheet-close')?.focus({ preventScroll: true });
                    } else {
                        modelMenu.style.left = '0px';
                        const bounds = modelMenu.getBoundingClientRect();
                        modelMenu.style.left = `${Math.min(0, window.innerWidth - bounds.right - 8)}px`;
                    }
                }
            });
            modelMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = e.target.closest('.model-dropdown-item[data-model-id]');
                if (!item || item.disabled || window.AedosConversation?.isActive?.()) return;
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
        function setConversationLock(locked) {
            locked = locked && window.AedosConversation?.isActive?.() === true;
            if (locked) closeAllDropdowns();
            if (modelBtn) {
                modelBtn.disabled = locked;
                modelBtn.setAttribute('aria-disabled', String(locked));
                if (locked) { modelMenu?.classList.add('hidden'); modelBtn.setAttribute('aria-expanded', 'false'); }
            }
            if (modeToggle) {
                modeToggle.disabled = locked;
                modeToggle.setAttribute('aria-disabled', String(locked));
            }
            modelOptions?.querySelectorAll('.model-dropdown-item').forEach(option => {
                option.disabled = locked || (paymentsPaused && option.dataset.paid === 'true');
                option.setAttribute('aria-disabled', String(option.disabled));
            });
            if (newConversationBtn) newConversationBtn.hidden = !locked || window.location.hash !== '#chat';
        }
        newConversationBtn?.addEventListener('click', () => window.AedosConversation?.startNew());
        window.addEventListener('aedos:conversation-lock-changed', event => setConversationLock(Boolean(event.detail?.locked)));
        setConversationLock(window.AedosConversation?.isActive?.() === true);
        // eslint-disable-next-line complexity -- The event keeps model and slide controls synchronized with the selected mode.
        modeToggle?.addEventListener('click', () => {
            if (window.AedosConversation?.isActive?.()) return;
            const oldCount = creditsUI?.getSlideCount() || 1;
            generationState.proModeEnabled = !generationState.proModeEnabled;
            renderModeToggle();
            chatInputWrapper?.classList.toggle('is-pro', generationState.proModeEnabled);
            creditsUI?.setSlideCount(oldCount);
            const adjustedCount = creditsUI?.getSlideCount() || oldCount;
            if (adjustedCount < oldCount) creditsUI?.showModeClampNotice(adjustedCount,
                generationState.proModeEnabled ? 'pro' : 'flash');
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
                    if (window.matchMedia('(max-width: 480px)').matches) {
                        window.requestAnimationFrame(() => langMenu.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
                    }
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

        bindDismissEvents();

        function bindDismissEvents() {
            document.addEventListener('click', closeAllDropdowns);
            modelBackdrop?.addEventListener('click', closeAllDropdowns);
            document.getElementById('model-sheet-close')?.addEventListener('click', () => {
                closeAllDropdowns();
                modelBtn?.focus({ preventScroll: true });
            });
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape' && modelMenu && !modelMenu.classList.contains('hidden')) {
                    closeAllDropdowns();
                    modelBtn?.focus({ preventScroll: true });
                }
            });
            window.addEventListener('resize', closeAllDropdowns);
        }

        renderModels(window.MODEL_CATALOG || [], false);
    }

    api.createAppDropdowns = createAppDropdowns;
})(typeof window !== 'undefined' ? window : globalThis);
