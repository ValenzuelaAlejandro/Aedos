(function registerStateRestoreHandler(global) {
    'use strict';

    /**
     * @typedef {Object} StateRestoreDependencies
     * @property {Object} previewState Mutable preview model.
     * @property {Function} setupPreviewInteractions Existing preview setup callback.
     * @property {Function} getOverlayMap Reads the current overlay map.
     * @property {Function} getBuildOverlayForSlot Reads the current slot builder.
     * @property {Function} getEnsureInternalOverlay Reads the iframe overlay helper.
     * @property {Function} findSlides Existing slide lookup.
     * @property {Function} buildDots Existing dot renderer.
     * @property {Function} scrollToSlide Existing slide navigation.
     * @property {Function} updateSlideCounter Existing counter renderer.
     * @property {Function} getRefreshSlotOverlays Reads the active label-position function.
     */

    /** Register the editor's state-restored listener at its existing initialization point. @param {StateRestoreDependencies} deps */
    function createStateRestoreHandler({ previewState, setupPreviewInteractions, getOverlayMap, getBuildOverlayForSlot, getEnsureInternalOverlay, findSlides, buildDots, scrollToSlide, updateSlideCounter, getRefreshSlotOverlays }) {
            const iframeWinRef = previewState.previewIframe.contentWindow;
            if (iframeWinRef) {
                iframeWinRef.addEventListener('state-restored', (ev) => {
                    const needsRebuild = ev.detail ? ev.detail.needsOverlayRebuild : true;
                    if (!needsRebuild) return;
                    const iDoc = previewState.previewIframe.contentDocument;
                    if (!iDoc) return;
                    const overlayMap = getOverlayMap();

                    // CRITICAL: Cache width early for scrollToSlide calculations
                    previewState.previewIframe._slideWidthPx = 1122;

                    // --- OPTIMIZATION: Non-destructive overlay re-keying ---
                    // 1. Map existing overlays by their slot ID (string attribute - survives innerHTML replace)
                    const byId = new Map();
                    overlayMap.forEach((entry, slotEl) => {
                        const id = slotEl.dataset && slotEl.dataset.imageSlot;
                        if (id !== undefined) {
                            byId.set(String(id), entry);
                            if (entry.label) entry.label.style.display = 'none'; // Hide until repositioned
                        } else {
                            // Truly dead or no-id slot: clean up
                            if (entry.label) entry.label.remove();
                            if (entry.input) entry.input.remove();
                        }
                    });

                    // 2. Clear current map (we will refill it with the NEW DOM nodes)
                    overlayMap.clear();

                    // 3. Match new DOM nodes with existing labels/ref objects
                    iDoc.querySelectorAll('[data-image-slot]').forEach(newSlot => {
                        const id = String(newSlot.dataset.imageSlot);
                        const entry = byId.get(id);
                        if (entry) {
                            // RE-KEY: update the mutable ref to point to the NEW DOM node
                            entry.slotRef.current = newSlot;
                            overlayMap.set(newSlot, entry);
                        } else {
                            // Truly new slot (e.g. from copy-paste or redo)
                            getBuildOverlayForSlot()(newSlot);
                        }

                        // REBUILD internal visual message (only if missing)
                        getEnsureInternalOverlay()(newSlot, iDoc);
                    });

                    // REBUILD iframe-internal visible overlays and re-bind listeners
                    // REDUCED timeout: 150ms was too slow, causing visual lag
                    clearTimeout(window._restoreBatchT);
                    window._restoreBatchT = setTimeout(() => {
                        iDoc._restoringState = true;
                        setupPreviewInteractions(previewState.currentSlide);
                        iDoc._restoringState = false;

                        // Final refresh of overlay positions
                        if (window._refreshSlotOverlays) window._refreshSlotOverlays();
                    }, 40);

                    // --- REFRESH SLIDE SYSTEM ---
                    const slides = findSlides(iDoc);
                    previewState.totalSlides = slides.length || 1;
                    buildDots();

                    // Re-find and re-init the slide container (it might be a new DOM node after innerHTML replace)
                    previewState.slideContainer = (slides.length > 0) ? slides[0].parentElement : iDoc.body;

                    // Re-apply critical styles to new slide nodes
                    slides.forEach(s => {
                        s.style.flex = `0 0 1122px`;
                        s.style.width = `1122px`;
                        s.style.height = '631px';
                        s.style.overflow = 'hidden';
                        s.style.position = 'relative';
                        s.style.boxSizing = 'border-box';
                    });

                    if (previewState.slideContainer) {
                        previewState.slideContainer.style.display = 'flex';
                        previewState.slideContainer.style.flexDirection = 'row';
                        previewState.slideContainer.style.width = 'max-content';
                        previewState.slideContainer.style.height = '100%';
                        previewState.slideContainer.style.margin = '0';
                        previewState.slideContainer.style.padding = '0';
                        previewState.slideContainer.style.transition = 'none'; // Instant jump for sync

                        if (previewState.currentSlide >= previewState.totalSlides) previewState.currentSlide = previewState.totalSlides - 1;
                        if (previewState.currentSlide < 0) previewState.currentSlide = 0;

                        // Don't restore slide position from entry. User doesn't want to move.
                        scrollToSlide(previewState.currentSlide);

                        // Restore transition after reflow
                        setTimeout(() => {
                            if (previewState.slideContainer) previewState.slideContainer.style.transition = 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
                        }, 50);
                    }

                    updateSlideCounter();

                    // Reposition labels to the new slot positions
                    const refreshSlotOverlays = getRefreshSlotOverlays();
                    if (refreshSlotOverlays) {
                        setTimeout(refreshSlotOverlays, 100);
                        setTimeout(refreshSlotOverlays, 400);
                    }
                });
            }
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createStateRestoreHandler = createStateRestoreHandler;
})(window);
