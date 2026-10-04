(function registerSlotImageReplacement(global) {
    'use strict';

    /**
     * @typedef {{gifToStaticDataUrl: (file: File) => Promise<string>}} ContentUtils
     */

    /**
     * Create the existing image-slot replacement operations.
     * @param {{contentUtils: ContentUtils}} deps
     */
    function createSlotImageReplacement({ contentUtils }) {
        function replaceSlotImage(slot, file) {
            contentUtils.gifToStaticDataUrl(file).then((dataUrl) => applyImageToSlot(slot, dataUrl));
        }

        function replaceSlotWithUrl(slot, url) {
            applyImageToSlot(slot, url);
        }

        function applyImageToSlot(slot, imageDataOrUrl) {
            // Hide only placeholder layers. Keep real overlays intact so background
            // image readability settings are preserved when the user swaps the photo.
            const placeholderLayers = Array.from(slot.querySelectorAll(':scope > .img-bg1, :scope > .img-bg2'));
            placeholderLayers.forEach(layer => layer.style.display = 'none');

            // Apply image directly on the slot container
            slot.style.backgroundImage = `url('${imageDataOrUrl}')`;
            slot.style.backgroundSize = 'cover';
            slot.style.backgroundPosition = 'center';
            slot.style.backgroundRepeat = 'no-repeat';

            slot.classList.add('has-custom-image');

            // z-index and pointer-events for full-bleed slots are set once in
            // injectImageReplacementSystem and never need to change on image apply.
            // Siblings stay at z-index:2 / pointer-events:none permanently so text
            // is always visible and clicks always reach the slot for re-picking.
        }
        return { replaceSlotImage, replaceSlotWithUrl, applyImageToSlot };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createSlotImageReplacement = createSlotImageReplacement;
})(window);
