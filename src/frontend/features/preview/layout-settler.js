(function registerPreviewLayoutSettler(global) {
    'use strict';

    /**
     * @typedef {{iframeDoc: Document, targetIndex: number, setupPreviewInteractions: Function}} PreviewLayoutDependencies
     */

    /** Defer editor setup until preview images and fonts settle. @param {PreviewLayoutDependencies} deps @returns {boolean} */
    function deferUntilLayoutSettled({ iframeDoc, targetIndex, setupPreviewInteractions }) {
            const settlePreviewLayout = () => {
                const images = Array.from(iframeDoc.images || []);
                const imageLoads = images.map((image) => {
                    if (image.complete) return Promise.resolve();
                    return new Promise(resolve => {
                        const done = () => resolve();
                        image.addEventListener('load', done, { once: true });
                        image.addEventListener('error', done, { once: true });
                        setTimeout(done, 2500);
                    });
                });
                const fontsReady = iframeDoc.fonts && iframeDoc.fonts.ready
                    ? Promise.race([iframeDoc.fonts.ready, new Promise(resolve => setTimeout(resolve, 2500))])
                    : Promise.resolve();
                return Promise.all([Promise.all(imageLoads), fontsReady]);
            };

            // Do not block the rest of setup on a third-party asset forever.  The
            // carousel is functional even when one image/CDN request fails.
            if (!iframeDoc.documentElement.dataset.aedosLayoutSettled) {
                iframeDoc.documentElement.dataset.aedosLayoutSettled = 'pending';
                const finishPreviewLayout = () => {
                    iframeDoc.documentElement.dataset.aedosLayoutSettled = 'ready';
                    try {
                        setupPreviewInteractions(targetIndex);
                    } catch (error) {
                        console.error('[Aedos] Preview layout setup failed after assets settled.', error);
                    }
                };
                settlePreviewLayout().then(finishPreviewLayout, (error) => {
                    console.error('[Aedos] Preview asset settling failed; continuing with available layout.', error);
                    finishPreviewLayout();
                });
                return true;
            }
            return false;
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.deferUntilLayoutSettled = deferUntilLayoutSettled;
})(window);
