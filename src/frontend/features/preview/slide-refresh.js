(function registerSlideRefresh(global) {
    'use strict';

    /**
     * @typedef {Object} SlideRefreshDependencies
     * @property {Object} previewState Mutable preview state.
     * @property {Function} findSlides Existing slide lookup.
     * @property {Function} buildDots Existing dot renderer.
     * @property {Function} scrollToSlide Existing slide navigation.
     * @property {Function} updateSlideCounter Existing counter renderer.
     * @property {Function} getRefreshSlotOverlays Reads the current overlay refresher.
     */

    /** Create the existing global slide refresh operation. @param {SlideRefreshDependencies} deps */
    function createSlideRefresh({ previewState, findSlides, buildDots, scrollToSlide, updateSlideCounter, getRefreshSlotOverlays }) {
        return function regenerateDotsCount() {
            const iframeDoc = previewState.previewIframe.contentDocument || previewState.previewIframe.contentWindow.document;
            if (!iframeDoc) return;
            const slides = findSlides(iframeDoc);
            previewState.totalSlides = slides.length || 1;

            // Refresh slideContainer reference (it might have been replaced during Undo/Redo)
            previewState.slideContainer = (slides.length > 0) ? slides[0].parentElement : iframeDoc.body;

            if (previewState.slideContainer) {
                previewState.slideContainer.style.cssText += '; display:flex !important; flex-direction:row !important; width:max-content !important; height:100%; transition:transform 0.6s cubic-bezier(0.25,1,0.5,1); margin:0; padding:0;';
            }



            // Ensure new slides have the correct layout/scaling
            slides.forEach(s => {
                s.style.flex = `0 0 1122px`;
                s.style.width = `1122px`;
                s.style.height = '631px';
                s.style.overflow = 'hidden';
                s.style.position = 'relative';
                s.style.boxSizing = 'border-box';
            });

            buildDots();

            // Ensure currentSlide is within bounds before syncing classes
            if (previewState.currentSlide >= previewState.totalSlides) {
                previewState.currentSlide = previewState.totalSlides - 1;
            }
            if (previewState.currentSlide < 0) previewState.currentSlide = 0;

            // Force 'active' class to match currentSlide JS state
            slides.forEach((s, idx) => {
                if (idx === previewState.currentSlide) s.classList.add('active');
                else s.classList.remove('active');
            });

            scrollToSlide(previewState.currentSlide);
            updateSlideCounter();



            // Refresh overlays because new slides might have slots
            if (getRefreshSlotOverlays()) setTimeout(getRefreshSlotOverlays(), 50);
        };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createSlideRefresh = createSlideRefresh;
})(window);
