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
        const tierLabels = { free: 'Gratis', light: 'Ligero', standard: 'Estándar' };
        function selectModel(model) {
            generationState.selectedModelId = model.id;
            if (currentModelLabel) currentModelLabel.textContent = model.name;
            if (currentModelIcon) currentModelIcon.textContent = model.icon || '✨';
            creditsUI?.updateCostPreview();
        }
        function renderModels(models, paymentsPaused) {
            if (!modelOptions) return;
            modelOptions.replaceChildren();
            if (creditsUI) creditsUI.setModels(models);
            const visibleModels = models.filter(model => !paymentsPaused || model.tier === 'free');
            ['free', 'light', 'standard'].forEach(tier => {
                const tierModels = visibleModels.filter(model => model.tier === tier);
                if (!tierModels.length) return;
                const heading = document.createElement('div');
                heading.className = 'model-tier-heading';
                heading.textContent = tierLabels[tier];
                modelOptions.appendChild(heading);
                tierModels.forEach(model => {
                    const option = document.createElement('button');
                    option.type = 'button';
                    option.className = 'dropdown-item model-dropdown-item';
                    option.dataset.modelId = model.id;
                    option.setAttribute('role', 'menuitemradio');
                    option.setAttribute('aria-checked', String(model.id === generationState.selectedModelId));
                    const icon = document.createElement('span'); icon.className = 'model-option-icon'; icon.textContent = model.icon || '✨';
                    const name = document.createElement('span'); name.className = 'model-option-name'; name.textContent = model.name;
                    const cost = document.createElement('span'); cost.className = 'model-option-cost'; cost.textContent = `${model.creditsPerSlide} cr/slide`;
                    option.append(icon, name, cost);
                    if (model.id === generationState.selectedModelId) option.classList.add('active');
                    modelOptions.appendChild(option);
                });
            });
            document.getElementById('model-payment-paused-message')?.classList.toggle('hidden', !paymentsPaused);
            if (paymentsPaused) creditsUI?.updateStatus('Paid models are paused. Free models remain available.', 'paused');
            else if (document.getElementById('credits-status')?.dataset.state === 'paused') creditsUI?.updateStatus('');
            if (!visibleModels.some(model => model.id === generationState.selectedModelId) && visibleModels[0]) selectModel(visibleModels[0]);
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
                modelMenu.querySelectorAll('.model-dropdown-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                closeAllDropdowns();
            });
        }
        modeButtons?.forEach(button => button.addEventListener('click', () => {
            generationState.proModeEnabled = button.dataset.generationMode === 'pro';
            modeButtons.forEach(el => { const active = el === button; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); });
            chatInputWrapper?.classList.toggle('is-pro', generationState.proModeEnabled);
        }));
        if (creditsUI) creditsUI.refresh().then(result => {
            if (result) renderModels(result.models, result.paymentsPaused);
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
