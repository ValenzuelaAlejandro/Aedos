(function registerAedosImageSlotOverlays(root) {
const api = root.AedosPreview || (root.AedosPreview = {});

/**
 * @typedef {Object} ImageSlotOverlaySystemDeps
 * @property {Window} window
 * @property {Document} document
 * @property {Object} previewState
 * @property {Function} getOverlayMap
 * @property {Function} getReplaceSlotImage
 * @property {Function} getReplaceSlotWithUrl
 * @property {Function} setRefreshSlotOverlays
 * @property {Function} setBuildOverlayForSlot
 * @property {Function} isMobileViewport
 * @property {typeof setTimeout} setTimeout
 * @property {typeof CustomEvent} CustomEvent
 */

/** Own the iframe image-slot overlays, picker bridge, drag/drop and positioning lifecycle. */
// eslint-disable-next-line max-lines-per-function -- Keep one overlay lifecycle in its prior setup order.
api.createImageSlotOverlaySystem = function createImageSlotOverlaySystem(deps) {
    const {
        window,
        document,
        previewState,
        getOverlayMap,
        getReplaceSlotImage,
        getReplaceSlotWithUrl,
        setRefreshSlotOverlays,
        setBuildOverlayForSlot,
        isMobileViewport,
        setTimeout,
        CustomEvent,
    } = deps;

    // eslint-disable-next-line max-lines-per-function -- Preserve the legacy listener, slot and timer sequence.
    return function injectImageReplacementSystem(doc, isRestoringFlow = false) {
        const _overlayMap = getOverlayMap();
        const replaceSlotImage = getReplaceSlotImage();
        const replaceSlotWithUrl = getReplaceSlotWithUrl();
        let _buildOverlayForSlot = () => {};
        window.AedosPreview.createOverlayStyle({ doc });

        // ── Persistent parent-side label overlays ─────────────────────────────
        // WHY THIS APPROACH:
        //   • Clicks inside an iframe go to the iframe's document — NOT to the
        //     <iframe> element in the parent. So pointerdown on the iframe element
        //     never fires for inner-iframe clicks.
        //   • postMessage from iframe → parent is async → loses user activation →
        //     _picker.click() gets blocked by the browser.
        //   • SOLUTION: Place real <label>+<input type=file> elements in the PARENT
        //     document, permanently positioned over each slot's visual area.
        //     A click on the label (parent DOM) directly opens the picker — no
        //     focus handshake, no async, works on first click on desktop & mobile.

        // PERFORMANCE: If we are in a restore flow, we keep the existing DOM overlays
        // and just re-position them. The re-keying is handled before this call.
        if (!isRestoringFlow && !doc._restoringState) {
            // Remove any overlays from a previous session entirely
            document.querySelectorAll('._slot-overlay-label').forEach(el => el.remove());
            document.querySelectorAll('._slot-overlay-input').forEach(el => el.remove());
            _overlayMap.clear();
        }


        _buildOverlayForSlot = window.AedosPreview.createOverlayLabelBuilder({ overlayMap: _overlayMap, previewState, replaceSlotImage, replaceSlotWithUrl });
        setBuildOverlayForSlot(_buildOverlayForSlot);

        // eslint-disable-next-line no-shadow -- Retain the helper's iframe-document argument.
        function _ensureInternalOverlay(slot, doc) {
            let overlay = slot.querySelector('.img-replace-overlay');
            if (!overlay) {
                overlay = doc.createElement('div');
                overlay.className = 'img-replace-overlay';
                slot.appendChild(overlay);

                overlay.innerHTML = `
                    <div class="overlay-content" style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span>${isMobileViewport() ? window.__t('click_drop_mobile') : window.__t('click_drop')}</span>
                    </div>
                `;
            }
        }
        window._ensureInternalOverlay = _ensureInternalOverlay; // Expose as global helper

        // Build overlays for ALL slots in the document
        const allSlots = doc.querySelectorAll('[data-image-slot]');
        allSlots.forEach(s => _buildOverlayForSlot(s));

        // Double-click on a slot opens the file picker.
        // We expose this as a global function so the editor can call it directly.
        window._triggerImagePicker = (slot) => {
            // Block if in fullscreen (presentation mode)
            if (document.fullscreenElement || document.webkitFullscreenElement) return;

            const entry = _overlayMap.get(slot);
            if (entry) entry.input.click();
        };

        if (doc._dblClickListener) doc.removeEventListener('dblclick', doc._dblClickListener);
        doc._dblClickListener = (e) => {
            // Block if in fullscreen (presentation mode)
            if (document.fullscreenElement || document.webkitFullscreenElement) return;

            const slot = e.target.closest('[data-image-slot]');
            if (!slot) return;
            e.preventDefault();
            e.stopPropagation();
            window._triggerImagePicker(slot);
        };
        doc.addEventListener('dblclick', doc._dblClickListener);


        // Remove old custom event listener to avoid confusion
        // Remove old custom event listener to avoid confusion
        if (doc._triggerListener) doc.removeEventListener('trigger-image-picker', doc._triggerListener);
        doc._triggerListener = (e) => {
            if (e.detail && e.detail.element) window._triggerImagePicker(e.detail.element);
        };
        doc.addEventListener('trigger-image-picker', doc._triggerListener);




        // Enable labels only while a file is being dragged. Reset on drop/dragleave.
        window.addEventListener('dragenter', () => {
            if (typeof pruneDeadSlotOverlays === 'function') pruneDeadSlotOverlays();
            _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'auto'; });
        });
        window.addEventListener('dragleave', (e) => {
            // Only reset when leaving the window entirely
            // eslint-disable-next-line eqeqeq -- null also covers legacy undefined relatedTarget.
            if (e.relatedTarget == null) {
                _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'none'; });
            }
        });
        window.addEventListener('drop', () => {
            _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'none'; });
        });

        window.addEventListener('drop-complete', () => {
            _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'none'; });
        });

        const { pruneDeadSlotOverlays, positionOverlays } = window.AedosPreview.createOverlayPositioning({ previewState, overlayMap: _overlayMap, isMobileViewport });
        window._pruneDeadSlotOverlays = pruneDeadSlotOverlays;
        setRefreshSlotOverlays(positionOverlays);
        window._refreshSlotOverlays = positionOverlays;
        window._buildOverlayForSlot = _buildOverlayForSlot;

        // Message handler is no longer needed since overlays handle everything directly
        if (window._slotMsgHandler) {
            window.removeEventListener('message', window._slotMsgHandler);
            window._slotMsgHandler = null;
        }
        // ──────────────────────────────────────────────────────────────────────


        const slots = doc.querySelectorAll('[data-image-slot], .img-slot');
        slots.forEach(slot => {
            // eslint-disable-next-line no-unused-vars -- Retain the original dataset read in the slot traversal.
            const slotId = slot.dataset.imageSlot;

            // Ensure it has data-image-slot for consistency if it's an .img-slot
            if (!slot.dataset.imageSlot) {
                slot.dataset.imageSlot = 'gen-' + Math.random().toString(36).substr(2, 9);
            }

            // Ensure every normalized slot has a parent-side input/label entry.
            // Some templates define only .img-slot (without data-image-slot), and
            // those were previously skipped by the first overlay build pass.
            _buildOverlayForSlot(slot);

            // Hide decorative shapes (circles/blobs) — keep gradient overlays
            Array.from(slot.children).forEach(child => {
                const s = child.style;
                if (s.width && s.width !== '100%' && s.height && s.height !== '100%' && s.borderRadius === '50%') {
                    child.style.display = 'none';
                }
            });

            // For full-bleed slots (cover slides): the slot is a background layer.
            // Siblings render ON TOP (z-index:2) and have pointer-events:none so
            // the parent-side label overlay still shows above everything and
            // the user can always click/tap to pick an image.
            const computedPos = doc.defaultView.getComputedStyle(slot).position;
            const isFullBleed = computedPos === 'absolute' &&
                slot.parentElement && slot.parentElement.tagName === 'SECTION';
            if (isFullBleed) {
                Array.from(slot.parentElement.children).forEach(child => {
                    if (child !== slot) {
                        child.style.zIndex = '2'; // text renders above background image
                    }
                });
                slot.style.zIndex = '0';
            }
            // Note: pointer-events on siblings are left as-is — the parent label
            // overlay (z-index:200) handles all click routing.

            // "Click or drop image" tooltip
            _ensureInternalOverlay(slot, doc);

            // Drag & drop (works directly, no scaling issue)
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slot.classList.add('drag-over');
            });
            slot.addEventListener('dragleave', (e) => {
                e.preventDefault();
                slot.classList.remove('drag-over');
            });
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slot.classList.remove('drag-over');

                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith('image/')) {
                        replaceSlotImage(slot, file);
                        return;
                    }
                }
                const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
                    replaceSlotWithUrl(slot, imageUrl);
                }
            });
        });

        // Prevent browser default drag-and-drop navigation inside the iframe.
        // Without this, dropping a file anywhere on the iframe navigates it to the file URL.
        doc.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
        doc.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Handle dropping images onto the slide (NOT onto a slot)
            const slot = e.target.closest('[data-image-slot]');
            if (slot) return; // handled by slot listener

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith('image/')) {
                    // Position it where dropped
                // eslint-disable-next-line no-unused-vars -- Preserve the legacy layout measurement.
                const rect = doc.documentElement.getBoundingClientRect();
                    const x = e.clientX;
                    const y = e.clientY;

                    // Trigger a custom event to the parent to handle adding a new image at these coords
                    window.parent.dispatchEvent(new CustomEvent('add-image-at', {
                        detail: {
                            file: file,
                            x: x,
                            y: y
                        }
                    }));
                }
            }
        });

        // Initial positioning after all slots are set up
        // (done after multiple delays to account for carousel transition, font loading, etc.)
        setTimeout(positionOverlays, 100);
        setTimeout(positionOverlays, 500);
        setTimeout(positionOverlays, 1500);
    };
};
})(typeof window !== 'undefined' ? window : globalThis);
