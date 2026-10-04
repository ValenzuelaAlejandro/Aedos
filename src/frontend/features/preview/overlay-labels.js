(function registerOverlayLabelBuilder(global) {
    'use strict';

    /**
     * Build persistent parent-side image-slot labels with their original event order.
     * @param {{overlayMap: Map, previewState: Object, replaceSlotImage: Function, replaceSlotWithUrl: Function}} deps
     * @returns {(slotEl: HTMLElement, existingInput?: HTMLInputElement|null) => void}
     */
    function createOverlayLabelBuilder({ overlayMap, previewState, replaceSlotImage, replaceSlotWithUrl }) {
        return function buildOverlayForSlot (slotEl, existingInput = null) {
            if (overlayMap.has(slotEl)) return; // already built

            // Mutable ref so re-keying after Ctrl+Z just updates .current
            // instead of recreating all event listeners
            const slotRef = { current: slotEl };
            const slotIdCode = slotEl.dataset.imageSlot ? slotEl.dataset.imageSlot.replace(/[^a-z0-9]/gi, '') : Math.random().toString(36).substr(2, 9);
            const inputId = `img-input-${slotIdCode}`;

            const input = existingInput || document.createElement('input');
            if (!existingInput) {
                input.className = 'preview-file-input';
                input.type = 'file';
                input.id = inputId;
                input.name = inputId;
                input.accept = 'image/*';
                input.setAttribute('aria-label', 'Upload image');
                input.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;width:1px;height:1px;pointer-events:none;';
                document.body.appendChild(input);

                input.addEventListener('change', (e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        const iframeWin = previewState.previewIframe.contentWindow;
                        if (iframeWin && iframeWin.editorSaveState) iframeWin.editorSaveState();
                        replaceSlotImage(slotRef.current, e.target.files[0]);
                    }
                    input.value = ''; // Clear the input so the same file can be selected again
                });
            }

            const label = document.createElement('label');
            label.htmlFor = inputId;
            label.className = '_slot-overlay-label';
            label.style.cssText = 'position:fixed;display:none;z-index:100000;cursor:pointer;background:transparent;pointer-events:none;';
            label.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                input.click();
            });

            // Mobile: direct touch opens file picker without going through the
            // touch-capture-overlay (which calls preventDefault on touchstart,
            // tainting the gesture and blocking input.click() on iOS).
            label.addEventListener('touchstart', (e) => {
                e.stopPropagation(); // Don't let the touch-capture-overlay see this touch
            }, { passive: true });
            label.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                input.click();
            }, { passive: false });

            // Hover sync via live ref
            label.addEventListener('mouseenter', () => slotRef.current.classList.add('is-hovered'));
            label.addEventListener('mouseleave', () => slotRef.current.classList.remove('is-hovered'));

            label.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slotRef.current.classList.add('drag-over');
                label.style.outline = '2px dashed rgba(255,255,255,0.5)';
                label.style.outlineOffset = '-3px';
            });
            label.addEventListener('dragleave', (e) => {
                e.preventDefault();
                slotRef.current.classList.remove('drag-over');
                label.style.outline = '';
            });
            label.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slotRef.current.classList.remove('drag-over');
                label.style.outline = '';
                overlayMap.forEach(({ label: l }) => { l.style.pointerEvents = 'none'; });

                const files = e.dataTransfer.files;
                if (files && files.length > 0 && files[0].type.startsWith('image/')) {
                    const iframeWin = previewState.previewIframe.contentWindow;
                    if (iframeWin && iframeWin.editorSaveState) iframeWin.editorSaveState();
                    replaceSlotImage(slotRef.current, files[0]);
                    return;
                }
                const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
                    const iframeWin = previewState.previewIframe.contentWindow;
                    if (iframeWin && iframeWin.editorSaveState) iframeWin.editorSaveState();
                    replaceSlotWithUrl(slotRef.current, imageUrl);
                }
            });

            document.body.appendChild(label);

            overlayMap.set(slotEl, { input, label, slotRef });
        }
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createOverlayLabelBuilder = createOverlayLabelBuilder;
})(window);
