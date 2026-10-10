(function registerGenerateValidation(global) {
    'use strict';

    /** @typedef {{ window: Window, generationState: Object, btnGenerate: HTMLElement, temaInput: HTMLInputElement, getAnimateHeroTitle: Function }} GenerateValidationDependencies */
    /** Create the existing send-button and hero-title validation. @param {GenerateValidationDependencies} deps */
    function createGenerateValidation(deps) {
        const { window, generationState, btnGenerate, temaInput, getAnimateHeroTitle } = deps;
        return function validateGenerateButton() {
            if (btnGenerate && btnGenerate.classList.contains('is-generating')) {
                return;
            }
    
            const val = temaInput ? temaInput.value.trim() : '';
            const hasFiles = window._attachedFiles && window._attachedFiles.length > 0;
            const isActive = val.length >= 4 || hasFiles;
    
            const affordability = window.AedosCreditsUI?.updateCostPreview();
            if (btnGenerate) btnGenerate.disabled = !isActive || affordability?.affordable === false;
    
            // Animate hero title dynamically based on active state and language
            if (isActive) {
                if (!generationState.heroCustomTextActive) {
                    generationState.heroCustomTextActive = true;
                    getAnimateHeroTitle()(window.__t('hero_active'));
                }
            } else {
                if (generationState.heroCustomTextActive) {
                    generationState.heroCustomTextActive = false;
                    getAnimateHeroTitle()(window.__t('hero_line_1'));
                }
            }
        };
    }

    global.AedosChatValidation = Object.freeze({ createGenerateValidation });
})(window);
