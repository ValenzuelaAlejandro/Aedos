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
            modeBtn, modeMenu, langBtn, langMenu, exportMenuBtn, exportMenu,
            exportPptxBtn, currentModeLabel, currentLangLabel, chatInputWrapper,
        } = elements;

        function closeAllDropdowns() {
            if (modeMenu) modeMenu.classList.add('hidden');
            if (langMenu) langMenu.classList.add('hidden');
            if (exportMenu) exportMenu.classList.add('hidden');
            if (modeBtn) modeBtn.setAttribute('aria-expanded', 'false');
            if (langBtn) langBtn.setAttribute('aria-expanded', 'false');
            if (exportMenuBtn) exportMenuBtn.setAttribute('aria-expanded', 'false');
        }

        if (modeBtn && modeMenu) {
            modeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (modeBtn.disabled) return;
                const isHidden = modeMenu.classList.contains('hidden');
                closeAllDropdowns();
                if (isHidden) {
                    modeMenu.classList.remove('hidden');
                    modeBtn.setAttribute('aria-expanded', 'true');
                }
            });
            modeMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.dropdown-item[data-mode]');
                if (!item) return;
                const mode = item.dataset.mode;
                generationState.proModeEnabled = (mode === 'pro');
                modeMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                const labelKey = mode === 'pro' ? 'mode_pro_title' : 'mode_flash_title';
                if (currentModeLabel) {
                    currentModeLabel.textContent = window.__t(labelKey);
                    currentModeLabel.setAttribute('data-i18n', labelKey);
                }
                if (chatInputWrapper) chatInputWrapper.classList.toggle('is-pro', generationState.proModeEnabled);
                closeAllDropdowns();
            });
        }

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

        // Auto-lock pro mode when files are attached
        window._syncModeWithFiles = function () {
            if (!modeBtn) return;
            if (window._attachedFiles && window._attachedFiles.length > 0) {
                generationState.proModeEnabled = true;
                modeBtn.disabled = true;
                modeBtn.style.opacity = '0.6';
                modeBtn.style.cursor = 'not-allowed';
                modeBtn.parentElement.setAttribute('data-tooltip', window.__t('mode_tooltip_file_locked', 'High Quality is required to analyze files.'));
                if (currentModeLabel) currentModeLabel.textContent = window.__t('mode_pro_title', 'High Quality');
                if (chatInputWrapper) chatInputWrapper.classList.add('is-pro');
                if (modeMenu) modeMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('active', el.dataset.mode === 'pro'));
            } else {
                generationState.proModeEnabled = false;
                modeBtn.disabled = false;
                modeBtn.style.opacity = '';
                modeBtn.style.cursor = '';
                modeBtn.parentElement.removeAttribute('data-tooltip');
                if (currentModeLabel) currentModeLabel.textContent = window.__t('mode_flash_title', 'Fast Mode');
                if (chatInputWrapper) chatInputWrapper.classList.remove('is-pro');
                if (modeMenu) modeMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('active', el.dataset.mode === 'flash'));
            }
        };
    }

    api.createAppDropdowns = createAppDropdowns;
})(typeof window !== 'undefined' ? window : globalThis);
