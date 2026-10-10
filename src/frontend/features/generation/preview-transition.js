(function registerGenerationPreviewTransition(global) {
    const api = global.AedosGeneration || (global.AedosGeneration = {});

    /**
     * @typedef {Object} GenerationPreviewTransitionDeps
     * @property {Window} window
     * @property {Document} document
     * @property {Object} generationState
 * @property {Object} generation
 * @property {Function} getHasTransitioned
 * @property {Function} setHasTransitioned
     * @property {HTMLElement} chatScreen
     * @property {HTMLElement} previewHeader
     * @property {HTMLElement} previewContainer
     * @property {Object} previewState
     * @property {Function} stopBtnMessages
     * @property {Function} resetMobileZoomState
     * @property {Function} updateZoomDisplay
     * @property {Function} clearStageInlinePadding
     * @property {Function} scaleIframe
     * @property {Function} requestAnimationFrame
     * @property {Function} setTimeout
     */

    /** Create the once-only handoff from generation chat into streaming preview. */
    function createGenerationPreviewTransition(deps) {
        const {
            window, document, generationState, generation, chatScreen,
            previewHeader, previewContainer, previewState, stopBtnMessages,
            resetMobileZoomState, updateZoomDisplay, clearStageInlinePadding,
            scaleIframe, requestAnimationFrame, setTimeout, getHasTransitioned,
            setHasTransitioned,
        } = deps;

        return function doTransitionToPreview() {
            if (getHasTransitioned()) return;
            if (generationState.activeGeneration !== generation || generation.finalPreviewMounted) return;
            setHasTransitioned(true);
            generation.transitionStarted = true;
            stopBtnMessages();

            // Only transition the URL to #editor now that the editor has actually loaded!
            if (window.location.hash !== '#editor') {
                window.navigateToEditor();
            }

            // Clean up split outline layout and reset hero
            document.body.classList.remove('split-outline-active');
            const btnOutlineGenerate = document.getElementById('btn-outline-generate');
            if (btnOutlineGenerate) {
                btnOutlineGenerate.classList.remove('is-generating');
            }
            const heroTextSpan = document.querySelector('.hero-title-text');
            if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
                heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
                heroTextSpan.parentElement.classList.remove('waiting-state');
            }

            // Fade chat screen out (it's covered by fixed preview-container, but still clean)
            chatScreen.style.cssText = 'opacity:0;transition:opacity 0.35s ease;pointer-events:none;';
            setTimeout(() => {
                chatScreen.classList.add('hidden');
                chatScreen.style.cssText = '';
            }, 380);
            // Reveal preview (sectionFadeIn animation kicks in automatically)
            previewHeader.classList.remove('slide-down');
            previewContainer.classList.remove('hidden', 'reveal-chrome', 'reveal-sequence', 'reveal-minimap', 'reveal-tools', 'is-editor-ready');
            previewContainer.classList.add('is-generating', 'is-awaiting-first-slide');
            document.body.classList.add('no-scroll');

            // Kill any in-progress settling tween from a previous generation so its
            // onComplete never fires showFloatingPills during the new streaming session.
            if (previewState.settlingAnimation) { previewState.settlingAnimation.kill(); previewState.settlingAnimation = null; }

            // Reset panel insets so slide fills the full screen during streaming.
            previewState.editorInsets = { left: 0, right: 0, top: 0, bottom: 0 };
            resetMobileZoomState();
            window._manualZoomScale = 1;
            updateZoomDisplay();
            const scrollableReset = document.getElementById('preview-wrapper-scrollable');
            if (scrollableReset) scrollableReset.style.transform = '';
            // Clear any leftover inline stage padding from the previous settling animation
            // (CSS `is-generating .preview-stage { padding:0 !important }` also covers this).
            clearStageInlinePadding();

            // Double-rAF: the first rAF triggers style recalculation after display:none→flex;
            // the second rAF fires after layout is fully computed so getBoundingClientRect
            // returns accurate dimensions.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                scaleIframe();
                // Extra safety: call once more after 300ms in case the iframe resizes on load.
                setTimeout(scaleIframe, 300);
            }));
            window.addEventListener('resize', scaleIframe);
        };
    }

    api.createGenerationPreviewTransition = createGenerationPreviewTransition;
})(window);
