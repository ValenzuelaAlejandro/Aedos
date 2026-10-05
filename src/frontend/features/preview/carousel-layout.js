(function registerPreviewCarouselLayout(global) {
    'use strict';

    /**
     * @typedef {Object} PreviewCarouselDependencies
     * @property {Object} previewState Current slide and iframe state.
     * @property {HTMLElement} previewHeader Existing preview header.
     * @property {Function} injectImageReplacementSystem Existing overlay setup.
     * @property {Function} scrollToSlide Existing slide navigation.
     * @property {Function} updateSlideCounter Existing counter renderer.
     * @property {Function} scaleIframe Existing iframe scaler.
     * @property {Function} getRefreshSlotOverlays Reads the current overlay callback.
     */

    /** Create the original carousel layout operation for invocation at its former call site. @param {PreviewCarouselDependencies} deps */
    function createPreviewCarouselLayout({ previewState, previewHeader, injectImageReplacementSystem, scrollToSlide, updateSlideCounter, scaleIframe, getRefreshSlotOverlays }) {
        return function applyPreviewCarouselLayout({ slides, iframeDoc, targetIndex }) {
            // Determine the container that holds the slides (could be body or a wrapper like <main>)
            previewState.slideContainer = (slides.length > 0) ? slides[0].parentElement : iframeDoc.body;

            // ── CRITICAL: Lock slide dimensions to absolute CSS pixels ──
            // (1122px x 631px) ensuring cross-os consistency regardless of host DPI.
            const naturalSlideW = 1122;

            // Fix each slide to the captured pixel width AND height
            slides.forEach(s => {
                s.style.flex = `0 0 1122px`;
                s.style.width = `1122px`;
                s.style.height = '631px';
                s.style.overflow = 'hidden';
                s.style.position = 'relative';
                s.style.boxSizing = 'border-box';
            });

            // If we are restoring state, we handle overlay re-keying in the 'state-restored' event listener
            // instead of doing a full destructive clear and rebuild here.
            if (!iframeDoc._restoringState) {
                injectImageReplacementSystem(iframeDoc);
            }

            // Apply horizontal carousel layout to the real slide container
            previewState.slideContainer.style.display = 'flex';
            previewState.slideContainer.style.flexDirection = 'row';
            previewState.slideContainer.style.width = 'max-content';
            previewState.slideContainer.style.height = '100%';
            previewState.slideContainer.style.margin = '0';
            previewState.slideContainer.style.padding = '0';

            // Problem 9: Restore the "rewind" effect.
            // We capture how far the skeleton went and start the final render from there.
            const startSlide = previewState.currentSlide;
            if (startSlide > 0) {
                previewState.slideContainer.style.transform = `translateX(-${startSlide * naturalSlideW}px)`;
                // Force reflow BEFORE applying transition so the browser sees the start position
                void previewState.slideContainer.offsetWidth;
            }

            previewState.slideContainer.style.transition = 'transform 1.2s cubic-bezier(0.25, 1, 0.5, 1)';

            // Match minimap rewind speed
            const ml = document.getElementById('minimap-list');
            if (ml) ml.style.transition = 'transform 1.2s cubic-bezier(0.25, 1, 0.5, 1)';

            // Important: we don't reset currentSlide to 0 until scrollToSlide(targetIndex) runs
            scrollToSlide(targetIndex);

            // After the rewind is done, return to a faster, more responsive speed for editing
            setTimeout(() => {
                if (previewState.slideContainer) {
                    previewState.slideContainer.style.transition = 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
                }
                if (ml) {
                    ml.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
                }
            }, 1300);

            // Update overlays when carrousel transition ends
            previewState.slideContainer.removeEventListener('transitionend', getRefreshSlotOverlays());
            previewState.slideContainer.addEventListener('transitionend', () => {
                if (getRefreshSlotOverlays()) getRefreshSlotOverlays()();
            });

            // Store for scrollToSlide to use without re-measuring
            previewState.previewIframe._slideWidthPx = naturalSlideW;

            // Ensure no scrollbars ever show up in the preview window
            iframeDoc.documentElement.style.overflow = 'hidden';
            iframeDoc.body.style.overflow = 'hidden';
            iframeDoc.body.style.margin = '0';
            iframeDoc.body.style.padding = '0';

            scrollToSlide(targetIndex);
            updateSlideCounter();
            scaleIframe();
            window.addEventListener('resize', scaleIframe);

            // Remove the skeleton-active class safely AFTER applying final layouts to avoid scrollbars
            iframeDoc.documentElement.classList.remove('skeleton-active');
            previewHeader.classList.add('slide-down');

            // Force reset scroll positions left over by 'scrollIntoView' during the skeleton stream!
            // This was making the absolute transform value fight with the document's scroll offset.
            if (previewState.previewIframe.contentWindow) previewState.previewIframe.contentWindow.scrollTo(0, 0);
            if (iframeDoc.documentElement) iframeDoc.documentElement.scrollLeft = 0;
            if (iframeDoc.body) iframeDoc.body.scrollLeft = 0;
        };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createPreviewCarouselLayout = createPreviewCarouselLayout;
})(window);
