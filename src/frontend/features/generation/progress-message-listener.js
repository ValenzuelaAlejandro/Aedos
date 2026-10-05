(function registerGenerationProgressMessageListener(global) {
    const api = global.AedosGeneration || (global.AedosGeneration = {});

    /**
     * @typedef {Object} GenerationProgressMessageListenerDeps
     * @property {Window} window
     * @property {Document} document
     * @property {Object} previewState
     * @property {HTMLElement|null} slideLabel
     * @property {HTMLElement|null} previewContainer
     * @property {Object} previewUiState
     * @property {Function} setPreviewStreamStatus
     * @property {Function} buildDots
     * @property {Function} updateMinimapSkeleton
     */

    /** Register the legacy iframe progress listener using its original event order. */
    function createGenerationProgressMessageListener(deps) {
        const {
            window, document, previewState, slideLabel, previewContainer,
            previewUiState, setPreviewStreamStatus, buildDots, updateMinimapSkeleton,
        } = deps;

        window.addEventListener('message', (e) => {
            if (!e.data) return;
            // A removed streaming iframe may still have a queued postMessage. Never
            // let that stale event advance the current generation's UI state.
            if (e.source && previewState.previewIframe && previewState.previewIframe.contentWindow && e.source !== previewState.previewIframe.contentWindow) return;
            if (e.data.type === 'slideUpdate') {
                const count = e.data.count;
                previewState.totalSlides = count;
                if (slideLabel) {
                    const tpl = window.__t("slide_label_tpl", "{current} / {total}");
                    slideLabel.textContent = tpl.replace('{current}', count).replace('{total}', count);
                }
                previewState.currentSlide = count - 1;
                if (previewContainer && previewContainer.classList.contains('is-generating')) {
                    setPreviewStreamStatus(`Generando presentación… ${count} slide${count === 1 ? '' : 's'} recibida${count === 1 ? '' : 's'}`);
                }

                // The preview is now entered optimistically when /generate starts;
                // slideUpdate only advances the live progress indicator and dots.

                // Rebuild dots and minimap skeletons during generation.
                // During soft-regen the minimap stays frozen on the old thumbnails until
                // buildMinimap() replaces them after the final render.
                if (typeof buildDots === 'function') buildDots();
                if (!previewUiState.skipMinimapSkeleton) updateMinimapSkeleton(count);
            }
            if (e.data.type === 'titleUpdate') {
                const previewLabel = document.getElementById('preview-topic-label');
                if (previewLabel) {
                    // Keep it short if it's too long
                    let t = e.data.title.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    if (t.length > 50) t = t.substring(0, 47) + '...';
                    previewLabel.textContent = t;

                }
            }
        });
    }

    api.createGenerationProgressMessageListener = createGenerationProgressMessageListener;
})(window);
