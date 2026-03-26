/**
 * Eidoslab Mobile Bridge
 * Maps touch events to mouse events to enable editor interactivity on mobile
 * without modifying the core desktop-focused editor.js.
 * 
 * Version v=11 - SWIPE NAVIGATION + PAN + PINCH via overlay
 */
(function() {
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
            if (previewIframe && previewIframe.contentWindow && previewIframe.contentWindow.eidosDeselect) {
                previewIframe.contentWindow.eidosDeselect();
            }
        }

        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickStr.includes(`'${type}'`));
        });
    };

    function initMobileBridge() {
        const isMobile = () => window.innerWidth < 850;
        if (!isMobile()) return;

        // NOTE: app.js replaces the iframe DOM node via cloneNode/replaceChild every
        // time slides are rendered, so caching the reference leads to a stale pointer.
        // We always look up the current node dynamically via getElementById.

        let dragTarget = null;
        let panState = null; // single-finger view-pan when zoomed in

        // ── Pinch-to-zoom + 2-finger pan ──────────────────────────────────────
        // Registered at document level so it fires even when both fingers land
        // directly on the iframe (those touches go to the iframe document, not
        // the parent, so a stage-level listener never sees them).
        window._eidos_mobile_zoom = window._eidos_mobile_zoom || 1;
        window._eidos_pan = window._eidos_pan || { x: 0, y: 0 };
        let pinchState = null; // { startDist, startZoom, lastMidX, lastMidY }

        function getPinchDist(touches) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.hypot(dx, dy);
        }

        function applyZoomAndPan() {
            const iframe = document.getElementById('preview-iframe');
            const wrapper = document.querySelector('.preview-wrapper');
            const scrollable = document.getElementById('preview-wrapper-scrollable');
            if (!iframe || !wrapper) return;

            const baseScale = window._eidosBaseScale || 1;
            const mobileZoom = window._eidos_mobile_zoom || 1;
            const totalScale = baseScale * mobileZoom;

            iframe.style.transform = `scale(${totalScale})`;
            const scaledW = 1122 * totalScale;
            const scaledH = 631 * totalScale;
            wrapper.style.width = `${scaledW}px`;
            wrapper.style.height = `${scaledH}px`;

            // Clamp pan so the slide never goes fully off-screen
            const viewW = (scrollable ? scrollable.clientWidth : 0) || window.innerWidth;
            const viewH = (scrollable ? scrollable.clientHeight : 0) || window.innerHeight;
            const maxPanX = Math.max(0, (scaledW - viewW) / 2);
            const maxPanY = Math.max(0, (scaledH - viewH) / 2);
            if (mobileZoom <= 1) {
                window._eidos_pan.x = 0;
                window._eidos_pan.y = 0;
            } else {
                window._eidos_pan.x = Math.max(-maxPanX, Math.min(maxPanX, window._eidos_pan.x));
                window._eidos_pan.y = Math.max(-maxPanY, Math.min(maxPanY, window._eidos_pan.y));
            }
            wrapper.style.transform = `translate(${window._eidos_pan.x}px, ${window._eidos_pan.y}px)`;

            try {
                if (iframe.contentWindow) iframe.contentWindow._eidosIframeScale = totalScale;
            } catch (e) {}
        }

        function startPinchFromTouchList(touches) {
            if (!touches || touches.length !== 2) return;
            const midX = (touches[0].clientX + touches[1].clientX) / 2;
            const midY = (touches[0].clientY + touches[1].clientY) / 2;
            pinchState = {
                startDist: getPinchDist(touches),
                startZoom: window._eidos_mobile_zoom || 1,
                lastMidX: midX,
                lastMidY: midY
            };
        }

        function updatePinchFromTouchList(touches) {
            if (!pinchState || !touches || touches.length !== 2) return;
            const dist = getPinchDist(touches);
            const ratio = dist / pinchState.startDist;
            window._eidos_mobile_zoom = Math.max(0.5, Math.min(3, pinchState.startZoom * ratio));
            const midX = (touches[0].clientX + touches[1].clientX) / 2;
            const midY = (touches[0].clientY + touches[1].clientY) / 2;
            window._eidos_pan.x += midX - pinchState.lastMidX;
            window._eidos_pan.y += midY - pinchState.lastMidY;
            pinchState.lastMidX = midX;
            pinchState.lastMidY = midY;
            applyZoomAndPan();
        }

        function mapTouchToMouse(e, type) {
            // Multi-touch is handled by the pinch zoom system above
            if (e.touches && e.touches.length > 1) return;

            const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
            if (!touch) return;

            const iframe = document.getElementById('preview-iframe');
            if (!iframe) return;
            const iframeDoc = iframe.contentDocument;
            const iframeWin = iframe.contentWindow;
            if (!iframeDoc || !iframeWin) return;

            const rect = iframe.getBoundingClientRect();
            // Try to find scale in iframe first (where app.js sets it), then fallback to parent
            const scale = iframeWin._eidosIframeScale || window._eidosIframeScale || 1;
            
            // Map coordinates relative to INTERNAL iframe document
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
                // Precise hit testing inside the iframe
                dragTarget = iframeDoc.elementFromPoint(relX, relY) || iframeDoc.body;
                
                // CRITICAL IMPROVEMENT: If we hit something near a resize handle, give it priority
                const possibleHandle = dragTarget.closest('.eidos-resize-handle');
                if (possibleHandle) dragTarget = possibleHandle;
            }

            const target = dragTarget || iframeDoc.body;
            target.dispatchEvent(mouseEvent);

            if (type === 'mouseup') {
                dragTarget = null;
            }

            // Prevent scroll/gesture interference while dragging or resizing
            if (dragTarget && dragTarget !== iframeDoc.body && dragTarget !== iframeDoc.documentElement) {
                if (e.cancelable) e.preventDefault();
            }
        }

        // ── Transparent capture overlay (over the iframe in the parent DOM) ────────
        // Sits above the iframe in z-order so ALL touches on the slide area hit this
        // div — no cross-frame event routing needed.  2-finger events are also
        // forwarded to the document-level pinch handler below.
        const overlay = document.getElementById('touch-capture-overlay');
        if (overlay) {
            // gestureActive: null | 'drag' | 'pan' | 'slide-swipe'
            // Resolved once movement exceeds 8px threshold.
            let gestureActive = null;
            let swipeStartX = 0, swipeStartY = 0;

            overlay.addEventListener('touchstart', (e) => {
                if (e.touches.length > 1) {
                    // Multi-touch: cancel anything in-progress, let document-level pinch take over.
                    if (dragTarget) { mapTouchToMouse(e, 'mouseup'); dragTarget = null; }
                    panState = null;
                    gestureActive = null;
                    return;
                }
                const t = e.touches[0];
                swipeStartX = t.clientX;
                swipeStartY = t.clientY;
                gestureActive = null;
                if (window._eidos_mobile_zoom > 1) {
                    panState = {
                        startX: t.clientX, startY: t.clientY,
                        startPanX: window._eidos_pan.x, startPanY: window._eidos_pan.y,
                        moved: false
                    };
                }
                mapTouchToMouse(e, 'mousedown');
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            overlay.addEventListener('touchmove', (e) => {
                if (e.touches.length > 1) return; // handled by document-level pinch
                const t = e.touches[0];
                const dx = t.clientX - swipeStartX;
                const dy = t.clientY - swipeStartY;

                // ── Zoomed in: pan the view ──────────────────────────────────
                if (panState) {
                    if (!panState.moved && Math.hypot(dx, dy) > 8) {
                        panState.moved = true;
                        gestureActive = 'pan';
                        if (dragTarget) { mapTouchToMouse(e, 'mouseup'); dragTarget = null; }
                    }
                    if (panState.moved) {
                        window._eidos_pan.x = panState.startPanX + dx;
                        window._eidos_pan.y = panState.startPanY + dy;
                        applyZoomAndPan();
                        if (e.cancelable) e.preventDefault();
                        return;
                    }
                }

                // ── Normal zoom: resolve gesture type once threshold passed ──
                if (!gestureActive && Math.hypot(dx, dy) > 8) {
                    const isHoriz = Math.abs(dx) > Math.abs(dy) * 1.5;
                    if (isHoriz && window._eidos_mobile_zoom <= 1) {
                        gestureActive = 'slide-swipe';
                        // Cancel the mousedown drag that fired on touchstart
                        if (dragTarget) { mapTouchToMouse(e, 'mouseup'); dragTarget = null; }
                    } else {
                        gestureActive = 'drag';
                    }
                }

                if (gestureActive === 'slide-swipe') {
                    if (e.cancelable) e.preventDefault();
                    return; // don't forward mousemove — we'll navigate on touchend
                }

                if (dragTarget) mapTouchToMouse(e, 'mousemove');
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            overlay.addEventListener('touchend', (e) => {
                const ct = e.changedTouches[0];
                const dx = ct.clientX - swipeStartX;

                if (panState && panState.moved) {
                    panState = null;
                    dragTarget = null;
                    gestureActive = null;
                    return;
                }
                panState = null;

                if (gestureActive === 'slide-swipe') {
                    gestureActive = null;
                    dragTarget = null;
                    if (dx < -50 && window.eidosNextSlide) window.eidosNextSlide();
                    else if (dx > 50 && window.eidosPrevSlide) window.eidosPrevSlide();
                    return;
                }
                gestureActive = null;

                if (dragTarget) mapTouchToMouse(e, 'mouseup');
            }, { passive: false });

            overlay.addEventListener('touchcancel', (e) => {
                panState = null;
                gestureActive = null;
                if (dragTarget) mapTouchToMouse(e, 'mouseup');
            }, { passive: false });
        }

        // ── Document-level 2-finger pinch + pan ───────────────────────────────
        // Works anywhere on the page except the panel UI elements.
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 2) return;
            const t0 = e.touches[0];
            // Exclude panel/nav UI — allow everywhere else (stage, iframe, surrounding area)
            if (t0.target && t0.target.closest('#mobile-bottom-nav, .editor-tools-panel, .editor-minimap')) return;
            e.preventDefault();
            panState = null; // cancel any in-progress single-finger pan
            if (dragTarget) { dragTarget = null; } // cancel any in-progress single-touch drag
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
        // ────────────────────────────────────────────────────────────────────
        
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
                
                // Sync nav buttons
                document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
                    const onclickStr = btn.getAttribute('onclick') || '';
                    btn.classList.toggle('active', onclickStr.includes("'canvas'"));
                });
            };
            mobileOverlay.addEventListener('mousedown', closeOverlay);
            mobileOverlay.addEventListener('touchstart', closeOverlay, { passive: false });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileBridge);
    } else {
        initMobileBridge();
    }
})();
