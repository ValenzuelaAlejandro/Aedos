(function registerPreviewStreamStatus(global) {
    'use strict';

    /**
     * @typedef {Object} PreviewStreamStatusDependencies
     * @property {HTMLElement|null} statusText Existing status text node.
     * @property {HTMLElement|null} statusElement Existing status wrapper.
     */

    /** Create the existing live-generation status updater. @param {PreviewStreamStatusDependencies} deps */
    function createPreviewStreamStatus({ statusText, statusElement }) {
        return function setPreviewStreamStatus(text) {
            if (!statusText || typeof text !== 'string' || !text.trim()) return;
            statusText.textContent = text;
            if (statusElement) statusElement.setAttribute('aria-label', text);
        };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createPreviewStreamStatus = createPreviewStreamStatus;
})(window);
