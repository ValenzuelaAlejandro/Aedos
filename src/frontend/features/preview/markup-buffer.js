(function registerPreviewMarkupBuffer(global) {
    'use strict';

    /**
     * @typedef {Object} PreviewMarkupBufferDependencies
     * @property {Document} iframeDoc Live preview document.
     * @property {Function} setTimeout Existing timer API.
     * @property {Function} clearTimeout Existing timer API.
     */

    /** Create the existing bounded HTML queue and flush lifecycle. @param {PreviewMarkupBufferDependencies} deps */
    function createPreviewMarkupBuffer({ iframeDoc, setTimeout, clearTimeout }) {
        const MAX_STREAM_HTML_CHARS = 2_000_000;
        const STREAM_FLUSH_INTERVAL_MS = 80;
        let streamedHtmlChars = 0;
        let pendingPreviewMarkup = '';
        let previewFlushTimer = null;
        let previewStreamClosed = false;

        const flush = () => {
            if (!pendingPreviewMarkup || previewStreamClosed) return;
            iframeDoc.write(pendingPreviewMarkup);
            pendingPreviewMarkup = '';
        };
        const scheduleFlush = () => {
            if (previewFlushTimer !== null || previewStreamClosed) return;
            previewFlushTimer = setTimeout(() => {
                previewFlushTimer = null;
                flush();
            }, STREAM_FLUSH_INTERVAL_MS);
        };
        const queue = (markup) => {
            if (!markup) return;
            streamedHtmlChars += markup.length;
            if (streamedHtmlChars > MAX_STREAM_HTML_CHARS) throw new Error('GENERATION_OUTPUT_TOO_LARGE');
            pendingPreviewMarkup += markup;
            if (pendingPreviewMarkup.length >= 24000) flush();
            else scheduleFlush();
        };
        const clearTimer = () => {
            if (previewFlushTimer !== null) {
                clearTimeout(previewFlushTimer);
                previewFlushTimer = null;
            }
        };
        const markClosed = () => { previewStreamClosed = true; };
        const finish = () => {
            clearTimer();
            flush();
            iframeDoc.close();
            markClosed();
        };

        return { queue, clearTimer, markClosed, finish };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createPreviewMarkupBuffer = createPreviewMarkupBuffer;
})(window);
