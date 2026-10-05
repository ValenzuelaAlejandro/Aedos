(function registerAedosAppReset(global) {
    'use strict';

    /** @typedef {Object} ResetDependencies */
    /** @property {Document} document */
    /** @property {Object} errorModal */
    /** @property {HTMLElement|null} resultContainer */
    /** @property {HTMLElement|null} errorContainer */
    /** @property {HTMLElement|null} refusedContainer */
    /** @property {HTMLElement|null} previewContainer */
    /** @property {HTMLElement|null} chatScreen */
    /** @property {Object} previewState */
    /** @property {Function} clearSlotOverlays */
    /** @property {HTMLElement} slideDots */
    /** @property {HTMLElement|null} mobileSlideDots */
    /** @property {HTMLElement|null} mobileSlideLabel */
    /** @property {HTMLElement} progressBarEl */
    /** @property {Object} chatState */
    /** @property {Function} startTypewriter */

    /** Create the reset action using the existing DOM and live preview state. @param {ResetDependencies} deps */
    function createResetController(deps) {
        return function resetUI() {
            deps.document.body.classList.remove('no-scroll');
            deps.errorModal.clearOnDismiss();
            // Show chat again.
            if (deps.resultContainer) deps.resultContainer.classList.add('hidden');
            if (deps.errorContainer) deps.errorContainer.classList.add('hidden');
            if (deps.refusedContainer) deps.refusedContainer.classList.add('hidden');
            if (deps.previewContainer) deps.previewContainer.classList.add('hidden');
            if (deps.chatScreen) {
                deps.chatScreen.style.cssText = ''; // clear any in-progress fade
                deps.chatScreen.classList.remove('hidden');
            }

            deps.previewState.currentSlide = 0;
            deps.previewState.totalSlides = 0;
            deps.previewState.generatedHtml = '';
            deps.previewState.slideContainer = null;
            deps.clearSlotOverlays();
            // Remove persistent slot overlays from previous presentation.
            deps.document.querySelectorAll('._slot-overlay-label').forEach(el => el.remove());
            deps.document.querySelectorAll('._slot-overlay-input').forEach(el => el.remove());
            deps.slideDots.innerHTML = '';
            if (deps.mobileSlideDots) deps.mobileSlideDots.innerHTML = '';
            if (deps.mobileSlideLabel) deps.mobileSlideLabel.textContent = '1 / 1';
            deps.progressBarEl.style.transition = 'none';
            deps.progressBarEl.style.width = '0%';

            // restart typewriter if empty
            if (deps.document.getElementById('w-tema').value.trim() === '') {
                if (deps.chatState.chatPlaceholderContainer) deps.chatState.chatPlaceholderContainer.style.display = '';
                deps.startTypewriter();
            }
        };
    }

    global.AedosAppReset = global.AedosAppReset || {};
    global.AedosAppReset.createResetController = createResetController;
})(globalThis);
