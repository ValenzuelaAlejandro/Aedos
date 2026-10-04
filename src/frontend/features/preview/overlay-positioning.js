(function registerOverlayPositioning(global) {
    'use strict';

    /**
     * @typedef {Object} OverlayPositionDependencies
     * @property {Object} previewState Existing preview iframe state.
     * @property {Map<HTMLElement, Object>} overlayMap Current slot-label map.
     * @property {Function} isMobileViewport Existing viewport query.
     */

    /** Create slot-overlay cleanup and positioning operations. @param {OverlayPositionDependencies} deps */
    function createOverlayPositioning({ previewState, overlayMap, isMobileViewport }) {
            function pruneDeadSlotOverlays() {
                const iDoc = previewState.previewIframe.contentDocument;
                overlayMap.forEach((entry, slotEl) => {
                    if (!iDoc || !iDoc.contains(slotEl)) {
                        entry.label.remove();
                        entry.input.remove();
                        overlayMap.delete(slotEl);
                    }
                });
            }


            // Position overlays for the slots on the CURRENT slide, hide others
            function positionOverlays() {
                const iDoc = previewState.previewIframe.contentDocument;
                if (!iDoc || !iDoc.defaultView) return;
                const matrix = new DOMMatrix(getComputedStyle(previewState.previewIframe).transform);
                const scale = matrix.a || 1;
                const fr = previewState.previewIframe.getBoundingClientRect();

                // iDoc.defaultView.innerWidth is the "native" viewport width of the iframe
                const viewW = iDoc.defaultView.innerWidth;
                const viewH = iDoc.defaultView.innerHeight;

                overlayMap.forEach(({ label }, slotEl) => {
                    const r = slotEl.getBoundingClientRect(); // iframe-internal coords

                    // Resilience: Check if slot is actually visible in the iframe viewport
                    // We allow a small buffer for precision
                    const isVisible = r.width > 0 && r.height > 0 &&
                        r.left < viewW - 1 &&
                        r.right > 1 &&
                        r.top < viewH - 1 &&
                        r.bottom > 1;

                    if (!isVisible) {
                        label.style.display = 'none';
                        label.style.pointerEvents = 'none';
                        return;
                    }

                    // Show and position
                    label.style.display = 'block';
                    label.style.left = (fr.left + r.left * scale) + 'px';
                    label.style.top = (fr.top + r.top * scale) + 'px';
                    label.style.width = (r.width * scale) + 'px';
                    label.style.height = (r.height * scale) + 'px';
                    // On mobile, make label interactive so touch events go directly
                    // to the label (above the touch-capture-overlay in z-order),
                    // bypassing the overlay's preventDefault that would block input.click()
                    if (isMobileViewport()) {
                        label.style.pointerEvents = 'auto';
                    }
                });
            }



        return { pruneDeadSlotOverlays, positionOverlays };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createOverlayPositioning = createOverlayPositioning;
})(window);
