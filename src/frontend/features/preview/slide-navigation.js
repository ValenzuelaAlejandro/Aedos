(function registerSlideNavigation(global) {
    'use strict';

    /**
     * @typedef {Object} SlideNavigationDependencies
     * @property {Object} previewState Mutable preview model.
     * @property {HTMLElement} slideDots Desktop dot container.
     * @property {HTMLElement} slideLabel Desktop counter.
     * @property {HTMLElement|null} mobileSlideDots Mobile dot container.
     * @property {HTMLElement|null} mobileSlideLabel Mobile counter.
     * @property {(doc: Document) => Element[]} findSlides Existing slide lookup.
     * @property {() => (Function|null)} getRefreshSlotOverlays Existing overlay refresh callback.
     */

    /**
     * Register slide navigation and dot controls at their original bootstrap point.
     * @param {SlideNavigationDependencies} deps
     */
    // eslint-disable-next-line max-lines-per-function -- Navigation, dot rendering, and counters share live slide state.
    function createSlideNavigation({ previewState, slideDots, slideLabel, mobileSlideDots, mobileSlideLabel, findSlides, getRefreshSlotOverlays }) {
        // =========================================================
        // 8. SLIDE NAVIGATION
        // =========================================================
        function scrollToSlide(index) {
            const iframeDoc = previewState.previewIframe.contentDocument || previewState.previewIframe.contentWindow.document;
            if (!iframeDoc || !iframeDoc.body) return;
    
            const slides = findSlides(iframeDoc);
            const container = previewState.slideContainer || iframeDoc.body;
            if (slides[index]) {
                const iframeWin = previewState.previewIframe.contentWindow;
                const slideWidthPx = previewState.previewIframe._slideWidthPx
                    || (iframeWin && iframeWin.innerWidth > 0 ? iframeWin.innerWidth : 0)
                    || 1122; // Hard fallback for high-fidelity consistency
                container.style.transform = `translateX(-${index * slideWidthPx}px)`;
                slides.forEach(s => s.classList.remove('active'));
                slides[index].classList.add('active');
                previewState.currentSlide = index;
                window.currentSlide = index; // Expose globally for the editor iframe
                updateSlideCounter();
                // Reposition overlays for the new active slide
                const refreshSlotOverlays = getRefreshSlotOverlays();
                if (refreshSlotOverlays) setTimeout(refreshSlotOverlays, 50);
            }
        }
    
        // Global navigation helpers for editor and other modules
        const navigationState = { lastNavScroll: 0 };
        const NAV_COOLDOWN = 350; // ms to Wait between slide transitions to prevent skipping
    
        function tryNavigate(targetIndex) {
            if (Date.now() - navigationState.lastNavScroll < NAV_COOLDOWN) return false;
            if (targetIndex < 0 || targetIndex >= previewState.totalSlides) return false;
    
            navigationState.lastNavScroll = Date.now();
            scrollToSlide(targetIndex);
            return true;
        }
    
        window.scrollToSlide = scrollToSlide;
        window.prevSlide = () => tryNavigate(previewState.currentSlide - 1);
        window.nextSlide = () => tryNavigate(previewState.currentSlide + 1);
        window.getCurrentSlide = () => previewState.currentSlide;
        window.getTotalSlides = () => previewState.totalSlides;
    
        function notifySlideMetaUpdate() {
            document.dispatchEvent(new CustomEvent('slide-meta-updated', {
                detail: {
                    currentSlide: previewState.currentSlide,
                    totalSlides: previewState.totalSlides
                }
            }));
        }
    
        function syncMobileSlideCounterFallback() {
            if (!mobileSlideLabel && !mobileSlideDots) return;
    
            const safeTotal = Math.max(1, Number.isFinite(previewState.totalSlides) ? previewState.totalSlides : 1);
            const safeCurrent = Math.max(0, Math.min(safeTotal - 1, Number.isFinite(previewState.currentSlide) ? previewState.currentSlide : 0));
    
            if (mobileSlideLabel) {
                mobileSlideLabel.textContent = `${safeCurrent + 1} / ${safeTotal}`;
            }
    
            if (!mobileSlideDots) return;
    
            if (mobileSlideDots.children.length !== safeTotal) {
                mobileSlideDots.innerHTML = '';
                for (let i = 0; i < safeTotal; i++) {
                    const dot = document.createElement('button');
                    dot.className = 'slide-dot' + (i === safeCurrent ? ' active' : '');
                    dot.setAttribute('aria-label', `Slide ${i + 1}`);
                    dot.addEventListener('click', () => scrollToSlide(i));
                    mobileSlideDots.appendChild(dot);
                }
                return;
            }
    
            for (let i = 0; i < safeTotal; i++) {
                mobileSlideDots.children[i].classList.toggle('active', i === safeCurrent);
            }
        }
    
        function buildDots() {
            slideDots.innerHTML = '';
            for (let i = 0; i < previewState.totalSlides; i++) {
                const dot = document.createElement('button');
                dot.className = 'slide-dot' + (i === previewState.currentSlide ? ' active' : '');
                dot.setAttribute('aria-label', `Slide ${i + 1}`);
                dot.addEventListener('click', () => scrollToSlide(i));
                slideDots.appendChild(dot);
            }
            syncMobileSlideCounterFallback();
            notifySlideMetaUpdate();
        }
    
        function updateSlideCounter() {
            const dots = slideDots.querySelectorAll('.slide-dot');
            dots.forEach((d, i) => {
                d.classList.toggle('active', i === previewState.currentSlide);
            });
            const tpl = window.__t("slide_label_tpl", "Slide {current} of {total}");
            slideLabel.textContent = tpl.replace('{current}', previewState.currentSlide + 1).replace('{total}', previewState.totalSlides);
            syncMobileSlideCounterFallback();
            notifySlideMetaUpdate();
        }
        return { scrollToSlide, tryNavigate, navigationState, buildDots, updateSlideCounter };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createSlideNavigation = createSlideNavigation;
})(window);
