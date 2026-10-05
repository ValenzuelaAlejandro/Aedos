(function registerPreviewInteractions(global) {
    'use strict';

    /**
     * @typedef {Object} PreviewInteractionDependencies
     * @property {Object} previewState Current iframe and slide state.
     * @property {Object} previewUiState Page-owned initialization flags.
     * @property {HTMLElement} previewHeader Existing preview header.
     * @property {Object} uiLog Existing logger.
     * @property {Function} handleSlideWheelNav Existing wheel handler.
     * @property {Function} handleTouchStart Existing touch-start handler.
     * @property {Function} handleTouchEnd Existing touch-end handler.
     * @property {Function} injectImageReplacementSystem Existing slot overlay setup.
     * @property {Function} scrollToSlide Existing slide navigation.
     * @property {Function} updateSlideCounter Existing counter renderer.
     * @property {Function} buildDots Existing dot renderer.
     * @property {Function} scaleIframe Existing iframe scaler.
     * @property {Function} isMobileViewport Existing responsive query.
     * @property {Function} getRefreshSlotOverlays Reads the current overlay refresher.
     * @property {Function} getOverlayMap Reads the current overlay map.
     * @property {Function} getBuildOverlayForSlot Reads the current slot builder.
     * @property {Function} getStabilizeMinimapOnNextPreviewInit Reads the pending layout flag.
     * @property {Function} setStabilizeMinimapOnNextPreviewInit Writes the pending layout flag.
     */

    /** Create iframe interactions and original preview globals. @param {{getDeps: () => PreviewInteractionDependencies, MOBILE_BREAKPOINT: number, resetMobileZoomState: Function}} deps */
    // eslint-disable-next-line max-lines-per-function -- Setup, refresh compatibility, and zoom bootstrap preserve one initialization order.
    function createPreviewInteractions({ getDeps, MOBILE_BREAKPOINT, resetMobileZoomState }) {
        // eslint-disable-next-line max-lines-per-function, complexity -- Preserve the current preview setup sequence.
        function setupPreviewInteractions(targetIndex = 0) {
        const { previewState, previewUiState, previewHeader, uiLog, handleSlideWheelNav, handleTouchStart, handleTouchEnd, injectImageReplacementSystem, scrollToSlide, updateSlideCounter, buildDots, scaleIframe, isMobileViewport, findSlides, getRefreshSlotOverlays, getOverlayMap, getBuildOverlayForSlot, getStabilizeMinimapOnNextPreviewInit, setStabilizeMinimapOnNextPreviewInit } = getDeps();
        const iframeDoc = previewState.previewIframe.contentDocument || previewState.previewIframe.contentWindow.document;
        if (!iframeDoc || !iframeDoc.body) return;

        // Images and web fonts can change slide geometry after the iframe load
        // event.  Initialize the carousel/editor only after the layout has had a
        // chance to settle; otherwise the first setup can measure zero-sized
        // slides and leave the editor apparently blank.
        if (window.AedosPreview.deferUntilLayoutSettled({ iframeDoc, targetIndex, setupPreviewInteractions })) return;

        // ── INJECT GOOGLE FONTS INTO LIVE PREVIEW IFRAME ──
        // The AI-generated HTML only imports the theme fonts (e.g. Syne + DM Sans via @import).
        // Font picker options like Playfair Display, Bebas Neue, etc. are NOT loaded in this document,
        // so changing font-family has no visual effect even though the inline style is applied correctly.
        // Fix: explicitly create <link> elements in the iframe's <head>.
        if (iframeDoc.head && !iframeDoc.head.querySelector('link[data-fonts]')) {
            const preconnect1 = iframeDoc.createElement('link');
            preconnect1.rel = 'preconnect';
            preconnect1.href = 'https://fonts.googleapis.com';
            iframeDoc.head.appendChild(preconnect1);

            const preconnect2 = iframeDoc.createElement('link');
            preconnect2.rel = 'preconnect';
            preconnect2.href = 'https://fonts.gstatic.com';
            preconnect2.crossOrigin = 'anonymous';
            iframeDoc.head.appendChild(preconnect2);

            const fontLink = iframeDoc.createElement('link');
            fontLink.rel = 'stylesheet';
            fontLink.dataset.fonts = '1';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap';
            iframeDoc.head.appendChild(fontLink);
            uiLog.info('PREVIEW', 'Google Fonts injected into live preview iframe');
        }

        const slides = findSlides(iframeDoc);
        previewState.totalSlides = slides.length || 1;
        // buildDots() was redundant here as it's called after restoration anyway

        // Attach global nav listeners only once to avoid memory leaks and CPU peaks
        if (!iframeDoc._listenersAttached) {
            iframeDoc.addEventListener('wheel', handleSlideWheelNav, { passive: true });
            iframeDoc.addEventListener('touchstart', handleTouchStart, { passive: true });
            iframeDoc.addEventListener('touchend', handleTouchEnd, { passive: true });
            iframeDoc._listenersAttached = true;
        }


        const applyPreviewCarouselLayout = window.AedosPreview.createPreviewCarouselLayout({ previewState, previewHeader, injectImageReplacementSystem, scrollToSlide, updateSlideCounter, scaleIframe, getRefreshSlotOverlays: () => getRefreshSlotOverlays() });
        applyPreviewCarouselLayout({ slides, iframeDoc, targetIndex });

        // Init React-like declarative UI binding for Editor Panels
        if (typeof window.initEditorUI === 'function' && !iframeDoc._aedosEditorUIReady) {
            try {
                window.initEditorUI(previewState.previewIframe);
                iframeDoc._aedosEditorUIReady = true;
            } catch (error) {
                // A panel failure must not prevent the carousel from becoming
                // usable. It can be retried on the next preview refresh.
                iframeDoc._aedosEditorUIError = error;
                uiLog.warn('PREVIEW', 'Editor UI initialization failed; keeping carousel active', {
                    message: error && error.message ? error.message : String(error)
                });
            }
        }

        // On mobile: canvas is read-only. Image-slot overlays (parent-frame labels) are
        // independent of the lock so photo upload still works normally.
        if (isMobileViewport()) {
            const iw = previewState.previewIframe.contentWindow;
            if (iw && typeof iw.setLocked === 'function') {
                iw.setLocked(true);
            }
        }

        // Soft-regenerate can leave the fresh minimap cloning from a DOM that has not yet been
        // normalized by the editor. The user's manual workaround (select any element) triggers
        // freezeSlideLayout() and then the minimap refreshes from that stable geometry. Do the
        // same here before initMinimap builds the final thumbnails.
        if (getStabilizeMinimapOnNextPreviewInit()) {
            const iw = previewState.previewIframe.contentWindow;
            if (iw && typeof iw.freezeAllSlides === 'function') {
                iw.freezeAllSlides();
            }
            setStabilizeMinimapOnNextPreviewInit(false);
        }

        // Building all thumbnail iframes is the heaviest synchronous step in
        // preview setup.  Do not hold the editor reveal on it: on a deck with
        // remote images/fonts, the browser can spend several seconds doing
        // layout and parsing while the finished slide is already visible.
        // Schedule it after the first paint so the carousel remains responsive.
        if (!iframeDoc._aedosEditorSubsystemsScheduled) {
            iframeDoc._aedosEditorSubsystemsScheduled = true;
            const initializeEditorSubsystems = () => {
                try {
                    if (typeof window.initMinimap === 'function' && !iframeDoc._aedosMinimapReady) {
                        window.initMinimap(previewState.previewIframe);
                        iframeDoc._aedosMinimapReady = true;
                        previewUiState.minimapAlreadyInit = true;
                    }
                    if (typeof window.initTools === 'function' && !iframeDoc._aedosToolsReady) {
                        window.initTools(previewState.previewIframe);
                        iframeDoc._aedosToolsReady = true;
                        previewUiState.toolsAlreadyInit = true;
                    }
                } catch (error) {
                    uiLog.warn('PREVIEW', 'Editor subsystem initialization failed; keeping carousel active', {
                        message: error && error.message ? error.message : String(error)
                    });
                } finally {
                    iframeDoc._aedosEditorSubsystemsScheduled = false;
                }
            };

            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(initializeEditorSubsystems, { timeout: 250 });
            } else {
                setTimeout(initializeEditorSubsystems, 0);
            }
        }

        // Fix #4/#5/#6: After Ctrl+Z, restoreState replaces body.innerHTML, creating NEW
        // DOM nodes. Parent labels are still valid but getOverlayMap() keys point to DEAD nodes.
        // Strategy: re-key the map by matching data-image-slot IDs (stable across restores).
        // This avoids duplicate listeners and the full rebuild/teardown cost.
        window.AedosPreview.createStateRestoreHandler({ previewState, setupPreviewInteractions, getOverlayMap: () => getOverlayMap(), getBuildOverlayForSlot: () => getBuildOverlayForSlot(), getEnsureInternalOverlay: () => window._ensureInternalOverlay, findSlides, buildDots, scrollToSlide, updateSlideCounter, getRefreshSlotOverlays: () => getRefreshSlotOverlays() });

        // Warn user before leaving with unsaved work (bug #7)
        // Handled globally by the conditional beforeunload listener in app.js

        // Fix #8: Recalculate iframe scale when the right tools panel changes width
        const toolsPanel = document.getElementById('editor-tools-panel');
        if (toolsPanel && window.ResizeObserver) {
            const panelResizeObs = new ResizeObserver(() => {
                requestAnimationFrame(() => scaleIframe());
            });
            panelResizeObs.observe(toolsPanel);
        }
    }

    window.regenerateDotsCount = function () {
        const { previewState, findSlides, buildDots, scrollToSlide, updateSlideCounter, getRefreshSlotOverlays } = getDeps();
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


    const { syncZoomStateWithViewportMode, updateZoomDisplay } = window.AedosPreview.createZoomControls({ MOBILE_BREAKPOINT, resetMobileZoomState });
        return { setupPreviewInteractions, syncZoomStateWithViewportMode, updateZoomDisplay };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createPreviewInteractions = createPreviewInteractions;
})(window);
