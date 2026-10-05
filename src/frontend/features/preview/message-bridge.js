(function registerPreviewMessageBridge(global) {
    'use strict';

    /** @typedef {{ window: Window, document: Document, previewState: Object, getBuildDots: Function, getPreviewUiState: Function }} PreviewMessageBridgeDependencies */
    /** Register the existing iframe progress/title messages in original order. @param {PreviewMessageBridgeDependencies} deps */
    function createPreviewMessageBridge(deps) {
        const { window, document, previewState, previewContainer, slideLabel,
            setPreviewStreamStatus, updateMinimapSkeleton, getBuildDots, getPreviewUiState } = deps;
        // eslint-disable-next-line complexity -- Preserve the existing iframe message dispatch unchanged.
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
            const buildDots = getBuildDots();
            if (typeof buildDots === 'function') buildDots();
            const previewUiState = getPreviewUiState();
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

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createPreviewMessageBridge = createPreviewMessageBridge;
})(window);
