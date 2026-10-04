(function registerIframeScale(global) {
    'use strict';

    /**
     * @typedef {Object} IframeScaleDependencies
     * @property {Object} previewState Existing iframe and inset state.
     * @property {HTMLElement} previewContainer Existing preview container.
     * @property {Function} syncZoomStateWithViewportMode Existing responsive zoom sync.
     * @property {Function} updateZoomDisplay Existing zoom display callback.
     * @property {Function} clearStageInlinePadding Existing stage reset callback.
     * @property {Function} getRefreshSlotOverlays Reads the current overlay positioner.
     */

    /** Create iframe scaling and fullscreen handling without moving listener registration. @param {IframeScaleDependencies} deps */
    // eslint-disable-next-line max-lines-per-function -- Scaling and fullscreen share the same page geometry state.
    function createIframeScale({ previewState, previewContainer, syncZoomStateWithViewportMode, updateZoomDisplay, clearStageInlinePadding, getRefreshSlotOverlays }) {
        let _savedStagePadding = null;
        // eslint-disable-next-line complexity -- Preserve the existing responsive and fullscreen scale branches.
        function scaleIframe() {
            // Measure from a static parent that doesn't collapse with scale to prevent loop
            const stage = document.querySelector('.preview-stage');
            const wrapper = document.querySelector('.preview-wrapper');

            if (!wrapper || !stage || !previewState.previewIframe) return;

            const isMobileLayout = syncZoomStateWithViewportMode();

            const iframeNativeWidth = 1122;
            const iframeNativeHeight = 631;

            let scale = 1;
            let forceFitScale = false;
            const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);

            if (isFullscreen) {
                // Use full window dimensions without padding
                const availableWidth = window.innerWidth;
                const availableHeight = window.innerHeight;
                const MathScaleX = availableWidth / iframeNativeWidth;
                const MathScaleY = availableHeight / iframeNativeHeight;
                scale = Math.min(MathScaleX, MathScaleY);
                // Allow scaling up past 100% in presentation mode
            } else {
                // _editorInsets is {0,0,0,0} during streaming and is tweened by GSAP
                // during the settling animation so scaleIframe always gets the right values.
                const L = previewState.editorInsets.left, R = previewState.editorInsets.right;
                const T = previewState.editorInsets.top, B = previewState.editorInsets.bottom;
                const isStreamingState = previewContainer.classList.contains('is-generating') || previewContainer.classList.contains('is-settling');
                // Keep strict fit while streaming and in mobile layout, but allow
                // desktop zoom controls after returning from a mobile-width session.
                forceFitScale = isStreamingState || isMobileLayout;

                const scrollable = document.getElementById('preview-wrapper-scrollable');
                let availableWidth = 0;
                let availableHeight = 0;

                if (scrollable) {
                    const scrollRect = scrollable.getBoundingClientRect();
                    availableWidth = scrollRect.width;
                    availableHeight = scrollRect.height;
                } else {
                    // Fallback for edge cases where scrollable has not been mounted yet.
                    const stageRect = stage.getBoundingClientRect();
                    availableWidth = stageRect.width - L - R;
                    availableHeight = stageRect.height - T - B;
                }

                // Guard a couple of pixels to avoid sub-pixel rounding clipping at edges.
                const FIT_GUARD_PX = 2;
                availableWidth = Math.max(1, availableWidth - FIT_GUARD_PX);
                availableHeight = Math.max(1, availableHeight - FIT_GUARD_PX);

                const fitScaleX = availableWidth / iframeNativeWidth;
                const fitScaleY = availableHeight / iframeNativeHeight;
                const fitScale = Math.min(fitScaleX, fitScaleY);

                // During streaming the manual zoom must NOT apply — the slide should
                // fill the full viewport with no panels in the way.
                const requestedScale = forceFitScale ? fitScale : fitScale * window._manualZoomScale;

                // Keep the slide fully contained in editor mode (no clipping/cropping).
                scale = Math.min(requestedScale, fitScale);

                // Centering is achieved by setting asymmetric padding on the stage element
                // (done in the GSAP onUpdate / doTransitionToPreview). The scrollable is always
                // transform-free so it never overflows the parent's overflow:hidden boundary.
                if (scrollable) scrollable.style.transform = '';
            }

            window._baseScale = scale;
            const mobileZoom = forceFitScale ? 1 : (window._mobile_zoom || 1);
            const totalScale = scale * mobileZoom;

            previewState.previewIframe.style.transform = `scale(${totalScale}) translate3d(0,0,0)`;
            wrapper.style.height = `${iframeNativeHeight * totalScale}px`;
            wrapper.style.width = `${iframeNativeWidth * totalScale}px`;

            // Keep wrapper pan transform in sync with zoom state
            if (mobileZoom <= 1) {
                if (window._pan) { window._pan.x = 0; window._pan.y = 0; }
                wrapper.style.transform = 'translate3d(0,0,0)';
            } else if (window._pan) {
                wrapper.style.transform = `translate3d(${window._pan.x}px, ${window._pan.y}px, 0)`;
            }

            // Inject scale into iframe for the visual editor's coordinate math
            try {
                const iframeWin = previewState.previewIframe.contentWindow;
                if (iframeWin) iframeWin._iframeScale = totalScale;
                // eslint-disable-next-line no-empty -- Coordinate injection is best-effort when the iframe navigates.
            } catch (e) { }

            // Keep slot overlays aligned after scale change
            if (getRefreshSlotOverlays()) getRefreshSlotOverlays()();
        }

        // --- Fullscreen handling ---
        // When the preview-stage element enters fullscreen we must clear any
        // editor-added inline paddings (GSAP) so the slide can truly occupy
        // the full viewport. Restore previous paddings on exit.
        function handleFullscreenChange() {
            const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
            const stageEl = document.getElementById('preview-stage');
            if (!stageEl) return;

            if (isFS) {
                // Save current inline paddings
                _savedStagePadding = {
                    left: stageEl.style.paddingLeft || '',
                    right: stageEl.style.paddingRight || '',
                    top: stageEl.style.paddingTop || '',
                    bottom: stageEl.style.paddingBottom || ''
                };
                // Clear inline paddings so :fullscreen CSS / JS scaling can fill viewport
                clearStageInlinePadding();
                // Immediately recompute scale to fit true viewport
                updateZoomDisplay();
                scaleIframe();
            } else {
                // Restore previous paddings (if any) and rescale
                if (_savedStagePadding) {
                    stageEl.style.paddingLeft = _savedStagePadding.left || '';
                    stageEl.style.paddingRight = _savedStagePadding.right || '';
                    stageEl.style.paddingTop = _savedStagePadding.top || '';
                    stageEl.style.paddingBottom = _savedStagePadding.bottom || '';
                    _savedStagePadding = null;
                } else {
                    // Fallback: clear any stray inline padding and let scaleIframe use _editorInsets
                    clearStageInlinePadding();
                }
                // Outside fullscreen the editor enforces contain mode up to 100%.
                if (window._manualZoomScale > 1) {
                    window._manualZoomScale = 1;
                }
                updateZoomDisplay();
                // Small timeout to allow browser to exit fullscreen and reflow
                setTimeout(scaleIframe, 50);
            }
        }
        return { scaleIframe, handleFullscreenChange };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createIframeScale = createIframeScale;
})(window);
