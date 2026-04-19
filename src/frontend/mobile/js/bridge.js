/**
 * Mobile Bridge
 * Maps touch events to mouse events to enable editor interactivity on mobile
 * without modifying the core desktop-focused editor.js.
 *
 * Version v=12 - LONG-PRESS DRAG + INTENT-BASED GESTURE STATE MACHINE + DOUBLE-TAP FIX
 */
(function() {
    const mobileCfg = window.MobileConfig || { breakpoint: 850, longPressMs: 320 };

    // Global navigation toggle for mobile drawers
    window.toggleMobileDrawer = (type, e) => {
        if (e) e.stopPropagation();

        const minimap = document.getElementById('editor-minimap');
        const toolsPanel = document.getElementById('editor-tools-panel');
        const mobileOverlay = document.getElementById('mobile-overlay');
        const previewIframe = document.getElementById('preview-iframe');

        if (!minimap || !toolsPanel || !mobileOverlay) return;

        if (type === 'minimap') {
            minimap.classList.toggle('open');
            toolsPanel.classList.remove('open');
            const isOpen = minimap.classList.contains('open');
            mobileOverlay.classList.toggle('visible', isOpen);
            mobileOverlay.style.pointerEvents = isOpen ? 'auto' : 'none';
        } else if (type === 'tools') {
            toolsPanel.classList.toggle('open');
            minimap.classList.remove('open');
            const isOpen = toolsPanel.classList.contains('open');
            mobileOverlay.classList.toggle('visible', isOpen);
            mobileOverlay.style.pointerEvents = isOpen ? 'auto' : 'none';
        } else if (type === 'canvas') {
            minimap.classList.remove('open');
            toolsPanel.classList.remove('open');
            mobileOverlay.classList.remove('visible');
            mobileOverlay.style.pointerEvents = 'none';
            
            // Deselect element in editor
            if (previewIframe && previewIframe.contentWindow && previewIframe.contentWindow.editorDeselect) {
                previewIframe.contentWindow.editorDeselect();
            }
        }

        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickStr.includes(`'${type}'`));
        });
    };

    function initMobileBridge() {
        const isMobile = () => window.innerWidth <= mobileCfg.breakpoint;
        if (!isMobile()) return;

        let dragTarget = null;
        let panState = null;

        window._mobile_zoom = window._mobile_zoom || 1;
        window._pan = window._pan || { x: 0, y: 0 };
        let pinchState = null;

        // Cached DOM refs — resolved once, reused every frame
        let _cachedIframe = null;
        let _cachedWrapper = null;
        let _cachedScrollable = null;
        let _lastTotalScale = -1;
        let _rafZoomPending = false;

        function _resolveDOMRefs() {
            // Always re-query the DOM and update cached refs when elements change.
            // This handles the case where app.js replaces the preview iframe at runtime.
            const iframeEl = document.getElementById('preview-iframe');
            const wrapperEl = document.querySelector('.preview-wrapper');
            const scrollableEl = document.getElementById('preview-wrapper-scrollable');

            if (iframeEl !== _cachedIframe) _cachedIframe = iframeEl;
            if (wrapperEl !== _cachedWrapper) _cachedWrapper = wrapperEl;
            if (scrollableEl !== _cachedScrollable) _cachedScrollable = scrollableEl;
        }

        function getPinchDist(touches) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.hypot(dx, dy);
        }

        function _doApplyZoomAndPan() {
            _rafZoomPending = false;
            _resolveDOMRefs();
            const iframe = _cachedIframe;
            const wrapper = _cachedWrapper;
            const scrollable = _cachedScrollable;
            if (!iframe || !wrapper) return;

            const baseScale = window._baseScale || 1;
            const mobileZoom = window._mobile_zoom || 1;
            const totalScale = baseScale * mobileZoom;

            // Batch all reads before any writes
            const viewW = (scrollable ? scrollable.clientWidth : 0) || window.innerWidth;
            const viewH = (scrollable ? scrollable.clientHeight : 0) || window.innerHeight;

            // Writes
            const scaledW = 1122 * totalScale;
            const scaledH = 631 * totalScale;
            const maxPanX = Math.max(0, (scaledW - viewW) / 2);
            const maxPanY = Math.max(0, (scaledH - viewH) / 2);

            if (mobileZoom <= 1) {
                window._pan.x = 0;
                window._pan.y = 0;
            } else {
                window._pan.x = Math.max(-maxPanX, Math.min(maxPanX, window._pan.x));
                window._pan.y = Math.max(-maxPanY, Math.min(maxPanY, window._pan.y));
            }

            // Only update width/height when zoom actually changes (avoids layout on pure pan)
            if (totalScale !== _lastTotalScale) {
                _lastTotalScale = totalScale;
                iframe.style.transform = `scale(${totalScale})`;
                wrapper.style.width  = `${scaledW}px`;
                wrapper.style.height = `${scaledH}px`;
                try { if (iframe.contentWindow) iframe.contentWindow._iframeScale = totalScale; } catch (_) {}
            }

            // Pan: transform-only, no layout
            wrapper.style.transform = `translate(${window._pan.x}px, ${window._pan.y}px)`;
        }

        function applyZoomAndPan() {
            if (_rafZoomPending) return;
            _rafZoomPending = true;
            requestAnimationFrame(_doApplyZoomAndPan);
        }

        function startPinchFromTouchList(touches) {
            if (!touches || touches.length !== 2) return;
            const midX = (touches[0].clientX + touches[1].clientX) / 2;
            const midY = (touches[0].clientY + touches[1].clientY) / 2;
            pinchState = {
                startDist: getPinchDist(touches),
                startZoom: window._mobile_zoom || 1,
                lastMidX: midX,
                lastMidY: midY
            };
        }

        function updatePinchFromTouchList(touches) {
            if (!pinchState || !touches || touches.length !== 2) return;
            const dist = getPinchDist(touches);
            const ratio = dist / pinchState.startDist;
            window._mobile_zoom = Math.max(0.5, Math.min(3, pinchState.startZoom * ratio));
            const midX = (touches[0].clientX + touches[1].clientX) / 2;
            const midY = (touches[0].clientY + touches[1].clientY) / 2;
            window._pan.x += midX - pinchState.lastMidX;
            window._pan.y += midY - pinchState.lastMidY;
            pinchState.lastMidX = midX;
            pinchState.lastMidY = midY;
            applyZoomAndPan();
        }

        function mapTouchToMouse(e, type, overrideTouch) {
            if (!overrideTouch && e && e.touches && e.touches.length > 1) return;

            const touch = overrideTouch ||
                (e && e.touches && e.touches[0]) ||
                (e && e.changedTouches && e.changedTouches[0]);
            if (!touch) return;

            const iframe = document.getElementById('preview-iframe');
            if (!iframe) return;
            const iframeDoc = iframe.contentDocument;
            const iframeWin = iframe.contentWindow;
            if (!iframeDoc || !iframeWin) return;

            const rect = iframe.getBoundingClientRect();
            const scale = iframeWin._iframeScale || window._iframeScale || 1;
            
            const relX = (touch.clientX - rect.left) / scale;
            const relY = (touch.clientY - rect.top) / scale;

            const eventInit = {
                clientX: relX,
                clientY: relY,
                screenX: touch.screenX,
                screenY: touch.screenY,
                bubbles: true,
                cancelable: true,
                view: iframeWin,
                buttons: 1,
                which: 1,
                composed: true
            };

            const mouseEvent = new MouseEvent(type, eventInit);

            if (type === 'mousedown') {
                dragTarget = iframeDoc.elementFromPoint(relX, relY) || iframeDoc.body;
                const possibleHandle = dragTarget.closest('.editor-resize-handle');
                if (possibleHandle) dragTarget = possibleHandle;
            }

            const target = dragTarget || iframeDoc.body;
            target.dispatchEvent(mouseEvent);

            if (type === 'mouseup') {
                dragTarget = null;
            }

            if (dragTarget && dragTarget !== iframeDoc.body && dragTarget !== iframeDoc.documentElement) {
                if (e && e.cancelable) e.preventDefault();
            }
        }

        const overlay = document.getElementById('touch-capture-overlay');
        if (overlay) {
            const LONG_PRESS_MS  = mobileCfg.longPressMs;
            const MOVE_THRESHOLD = 10;
            const SWIPE_MIN      = 40;

            let mode = null;
            let longPressTimer = null;
            let touchOriginX = 0, touchOriginY = 0;
            let pendingTouchCoords = null;

            function cancelLP() {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            }

            overlay.addEventListener('touchstart', (e) => {
                if (e.touches.length > 1) {
                    cancelLP();
                    if (dragTarget) { mapTouchToMouse(e, 'mouseup'); dragTarget = null; }
                    panState = null;
                    mode = null;
                    return;
                }
                const t = e.touches[0];
                cancelLP();
                touchOriginX = t.clientX;
                touchOriginY = t.clientY;
                pendingTouchCoords = { clientX: t.clientX, clientY: t.clientY,
                                       screenX: t.screenX,  screenY: t.screenY };

                if (window._mobile_zoom > 1) {
                    mode = 'pan';
                    panState = {
                        startX: t.clientX,  startY: t.clientY,
                        startPanX: window._pan.x, startPanY: window._pan.y,
                        moved: false
                    };
                } else {
                    mode = 'pending';
                    // No long-press-drag: canvas is read-only on mobile
                }
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            overlay.addEventListener('touchmove', (e) => {
                if (e.touches.length > 1) return;
                const t = e.touches[0];
                const dx = t.clientX - touchOriginX;
                const dy = t.clientY - touchOriginY;
                const dist = Math.hypot(dx, dy);

                if (mode === 'pan' && panState) {
                    panState.moved = panState.moved || dist > MOVE_THRESHOLD;
                    window._pan.x = panState.startPanX + dx;
                    window._pan.y = panState.startPanY + dy;
                    applyZoomAndPan();
                    if (e.cancelable) e.preventDefault();
                    return;
                }

                if (mode === 'pending' && dist > MOVE_THRESHOLD) {
                    cancelLP();
                    const isHoriz = Math.abs(dx) > Math.abs(dy) * 1.4;
                    mode = isHoriz ? 'slide-swipe' : 'none';
                }

                if (mode === 'longpress-drag') {
                    mapTouchToMouse(e, 'mousemove');
                    if (e.cancelable) e.preventDefault();
                    return;
                }

                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            overlay.addEventListener('touchend', (e) => {
                cancelLP();
                const ct = e.changedTouches[0];
                const dx = ct.clientX - touchOriginX;
                const prevMode = mode;
                mode = null;

                if (prevMode === 'pan') {
                    panState = null;
                    dragTarget = null;
                    return;
                }

                if (prevMode === 'slide-swipe') {
                    dragTarget = null;
                    if (dx < -SWIPE_MIN && window.nextSlide) window.nextSlide();
                    else if (dx > SWIPE_MIN && window.prevSlide) window.prevSlide();
                    return;
                }

                if (prevMode === 'longpress-drag') {
                    mapTouchToMouse(e, 'mouseup');
                    return;
                }

                if (prevMode === 'pending') {
                    // Canvas is read-only on mobile.
                    // img-slot touches are handled directly by the positioned overlay labels
                    // (pointer-events:auto on mobile, z-index above the touch-capture-overlay)
                    // so they never reach this handler. Nothing else to do.
                    return;
                }

                if (dragTarget) mapTouchToMouse(e, 'mouseup');
            }, { passive: false });

            overlay.addEventListener('touchcancel', (e) => {
                cancelLP();
                panState = null;
                mode = null;  
                if (dragTarget) { mapTouchToMouse(e, 'mouseup'); dragTarget = null; }
            }, { passive: false });
        }

        document.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 2) return;
            const t0 = e.touches[0];
            if (t0.target && t0.target.closest('#mobile-bottom-nav, .editor-tools-panel')) return;
            e.preventDefault();
            panState = null;
            if (dragTarget) { dragTarget = null; }
            startPinchFromTouchList(e.touches);
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!pinchState || e.touches.length !== 2) return;
            e.preventDefault();
            updatePinchFromTouchList(e.touches);
        }, { passive: false });

        document.addEventListener('touchend', (e) => {
            if (pinchState && e.touches.length < 2) pinchState = null;
        }, { passive: false });

        document.addEventListener('touchcancel', () => { pinchState = null; }, { passive: false });
        
        const mobileOverlay = document.getElementById('mobile-overlay');
        const minimap = document.getElementById('editor-minimap');
        const toolsPanel = document.getElementById('editor-tools-panel');

        if (mobileOverlay) {
            const closeOverlay = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                if (minimap) minimap.classList.remove('open');
                if (toolsPanel) toolsPanel.classList.remove('open');
                mobileOverlay.classList.remove('visible');
                mobileOverlay.style.pointerEvents = 'none';
                
                document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
                    const onclickStr = btn.getAttribute('onclick') || '';
                    btn.classList.toggle('active', onclickStr.includes("'canvas'"));
                });
            };
            mobileOverlay.addEventListener('mousedown', closeOverlay);
            mobileOverlay.addEventListener('touchstart', closeOverlay, { passive: false });
        }

        // Minimap removed on mobile — touch-scrolling handled by desktop minimap only.

        // Mobile bottom-nav dot mirror:
        // Keeps #mobile-slide-dots in sync with the current presentation metadata.
        (function initMobileNavDots() {
            const sourceDots = document.getElementById('slide-dots');
            const mobileDotsEl = document.getElementById('mobile-slide-dots');
            const mobileLabelEl = document.getElementById('mobile-slide-label');
            if (!mobileDotsEl) return;

            function resolveSlideMeta(source) {
                const apiTotal = (typeof window.getTotalSlides === 'function') ? Number(window.getTotalSlides()) : 0;
                const apiCurrent = (typeof window.getCurrentSlide === 'function') ? Number(window.getCurrentSlide()) : 0;

                let total = Math.max(source.length, Number.isFinite(apiTotal) ? apiTotal : 0);
                let current = Number.isFinite(apiCurrent) ? apiCurrent : -1;

                if (current < 0) {
                    current = Array.from(source).findIndex((d) => d.classList.contains('active'));
                }

                try {
                    const iframe = document.getElementById('preview-iframe');
                    const iframeDoc = iframe && iframe.contentDocument;
                    if (iframeDoc) {
                        let slides = Array.from(iframeDoc.querySelectorAll('section.s'));
                        if (!slides.length) slides = Array.from(iframeDoc.querySelectorAll('section[class*="slide"]'));
                        if (!slides.length) slides = Array.from(iframeDoc.querySelectorAll('body > section'));

                        if (slides.length > total) total = slides.length;
                        if (current < 0) {
                            const activeFromIframe = slides.findIndex((s) => s.classList.contains('active'));
                            if (activeFromIframe >= 0) current = activeFromIframe;
                        }
                    }
                } catch (_) { }

                if (total <= 0) total = 1;
                if (current < 0) current = 0;
                current = Math.max(0, Math.min(total - 1, current));

                return { total, current };
            }

            function syncDots() {
                const source = sourceDots ? sourceDots.querySelectorAll('.slide-dot') : [];
                const meta = resolveSlideMeta(source);
                const total = meta.total;
                const current = meta.current;

                // Rebuild if count changed
                if (mobileDotsEl.children.length !== total) {
                    mobileDotsEl.innerHTML = '';
                    for (let i = 0; i < total; i++) {
                        const src = source[i];
                        const dot = document.createElement('button');
                        dot.className = 'slide-dot' + (i === current ? ' active' : '');
                        dot.setAttribute('aria-label', `Slide ${i + 1}`);
                        dot.addEventListener('click', () => {
                            if (src && typeof src.click === 'function') {
                                src.click();
                                return;
                            }
                            if (typeof window.scrollToSlide === 'function') {
                                window.scrollToSlide(i);
                            }
                        });
                        mobileDotsEl.appendChild(dot);
                    }
                } else {
                    for (let i = 0; i < total; i++) {
                        mobileDotsEl.children[i].classList.toggle('active', i === current);
                    }
                }

                if (mobileLabelEl) {
                    mobileLabelEl.textContent = `${current + 1} / ${total}`;
                }

                // Scroll to keep active dot centred
                const activeDot = mobileDotsEl.children[current];
                if (activeDot && mobileDotsEl.parentElement) {
                    const dotW = activeDot.offsetWidth + 5;
                    const containerW = mobileDotsEl.parentElement.offsetWidth;
                    const ideal = current * dotW - containerW / 2 + dotW / 2;
                    const max = Math.max(0, mobileDotsEl.scrollWidth - containerW);
                    mobileDotsEl.style.transform = `translateX(-${Math.max(0, Math.min(max, ideal))}px)`;
                }
            }

            if (sourceDots) {
                const obs = new MutationObserver(syncDots);
                obs.observe(sourceDots, {
                    subtree: true,
                    childList: true,
                    attributes: true,
                    attributeFilter: ['class']
                });
            }

            document.addEventListener('slide-meta-updated', syncDots);
            window.addEventListener('resize', syncDots, { passive: true });
            setInterval(syncDots, 1200);
            syncDots();
        })();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileBridge);
    } else {
        initMobileBridge();
    }
})();
