(function registerFinalPreviewReveal(global) {
    'use strict';

    /**
     * @typedef {Object} FinalPreviewRevealDependencies
     * @property {Window} window Existing animation and viewport APIs.
     * @property {Document} document Existing parent document.
     * @property {Document} iframeDoc Live streaming iframe document.
     * @property {Object} generationState Shared generation state.
     * @property {Object} generation Active generation identity.
     * @property {Object} previewState Shared preview state.
     * @property {Object} previewUiState Existing minimap and tools initialization flags.
     * @property {HTMLElement} previewContainer Existing preview root.
     * @property {HTMLElement|null} previewHeader Existing preview header.
     * @property {Function} initPreview Existing final HTML mount callback.
     * @property {Function} scaleIframe Existing iframe scaler.
     * @property {Function} clearPendingTransition Existing transition cleanup.
     * @property {Function} setTimeout Existing timer API.
     */

    /** Create the final iframe remount and editor chrome reveal. @param {FinalPreviewRevealDependencies} deps */
    // eslint-disable-next-line max-lines-per-function -- Preserve the remount and reveal sequence as one vertical cut.
    function createFinalPreviewReveal(deps) {
        const { window, document, iframeDoc, generationState, generation, previewState, previewUiState, previewContainer, previewHeader, initPreview, scaleIframe, clearPendingTransition, setTimeout } = deps;

        // eslint-disable-next-line max-lines-per-function -- Preserve the original timed reveal as a single callback.
        return async function revealFinalPreview() {
            try {
                if (iframeDoc && iframeDoc.querySelectorAll) {
                    iframeDoc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                        const raw = link.getAttribute('href') || '';
                        const match = raw.match(/^url\s*\(\s*['"]?(https?[^'"')\s]+)['"]?\s*\)/i);
                        if (match) link.href = match[1];
                    });
                }
            } catch (error) { /* cross-origin guard */ }

            const stage = document.getElementById('preview-stage');
            if (stage) stage.classList.add('flicker-mask');
            const minimapPanel = document.getElementById('editor-minimap');
            if (minimapPanel) minimapPanel.classList.add('flicker-mask');

            await new Promise(resolve => setTimeout(resolve, 100));

            previewUiState.minimapAlreadyInit = false;
            previewUiState.toolsAlreadyInit = false;
            const rawIframe = previewState.previewIframe.cloneNode();
            previewState.previewIframe.parentNode.replaceChild(rawIframe, previewState.previewIframe);
            previewState.previewIframe = rawIframe;

            initPreview(previewState.generatedHtml, () => {
                if (generationState.activeGeneration !== generation) return;
                generation.finalPreviewMounted = true;
                clearPendingTransition();

                setTimeout(() => {
                    if (generationState.activeGeneration !== generation) return;
                    if (stage) stage.classList.remove('flicker-mask');
                    if (minimapPanel) minimapPanel.classList.remove('flicker-mask');

                    previewContainer.classList.remove('hidden', 'is-generating');
                    previewContainer.classList.add('is-settling');

                    if (window.gsap && window.innerWidth > 768) {
                        previewState.settlingAnimation = window.gsap.to(previewState.editorInsets, {
                            left: 165,
                            right: 30,
                            top: 64,
                            bottom: 64,
                            duration: 1.2,
                            ease: 'expo.out',
                            onUpdate: () => {
                                const stageEl = document.getElementById('preview-stage');
                                if (stageEl) {
                                    stageEl.style.paddingLeft = `${previewState.editorInsets.left}px`;
                                    stageEl.style.paddingRight = `${previewState.editorInsets.right}px`;
                                    stageEl.style.paddingTop = `${previewState.editorInsets.top}px`;
                                    stageEl.style.paddingBottom = `${previewState.editorInsets.bottom}px`;
                                }
                                scaleIframe();
                            },
                            onStart: () => {
                                if (previewHeader) previewHeader.classList.add('slide-down');
                            },
                            onComplete: () => {
                                previewState.settlingAnimation = null;
                                showFloatingPills();
                                scaleIframe();
                            }
                        });
                    } else {
                        if (window.innerWidth > 768) {
                            previewState.editorInsets = { left: 165, right: 30, top: 64, bottom: 64 };
                            const fallbackStage = document.getElementById('preview-stage');
                            if (fallbackStage) {
                                fallbackStage.style.paddingLeft = '165px';
                                fallbackStage.style.paddingRight = '30px';
                                fallbackStage.style.paddingTop = '64px';
                                fallbackStage.style.paddingBottom = '64px';
                            }
                        }
                        if (previewHeader) previewHeader.classList.add('slide-down');
                        scaleIframe();
                        setTimeout(() => { showFloatingPills(); scaleIframe(); }, 800);
                    }

                    function showFloatingPills() {
                        if (previewContainer.classList.contains('is-generating')) {
                            console.error('[Aedos] Preview chrome state conflict: final editor mounted while is-generating remained active.', {
                                generationId: generation.id,
                                transitionStarted: generation.transitionStarted
                            });
                            previewContainer.classList.remove('is-generating');
                        }
                        previewContainer.classList.remove('is-settling');
                        previewContainer.classList.add('is-editor-ready');
                        const minimap = document.getElementById('editor-minimap');
                        if (minimap) {
                            if (window.gsap) window.gsap.fromTo(minimap, { opacity: 0 }, { opacity: 1, duration: 0.65, ease: 'power2.out' });
                            else minimap.style.opacity = '';
                        }
                    }
                }, 100);
            });
        };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createFinalPreviewReveal = createFinalPreviewReveal;
})(window);
