/**
 * Eidoslab Mobile Bridge
 * Maps touch events to mouse events to enable editor interactivity on mobile
 * without modifying the core desktop-focused editor.js.
 * 
 * Version v=13 - IMPROVED TOUCH: better scale detection, instant drag on selected,
 *                minimap touch-scroll, relaxed swipe, prev/next nav haptics
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

        // mapTouchToMouse can be called with e=null and overrideTouch when
        // dispatching from the long-press timer (no live touch event available).
        function mapTouchToMouse(e, type, overrideTouch) {
            // Multi-touch guard — skip when using overrideTouch (synthetic call)
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
            // Derive scale from actual rendered size vs the known internal iframe width (1122px).
            // This is reliable even before app.js sets _eidosIframeScale (e.g. first tap).
            const scale = rect.width > 0 ? rect.width / 1122 : (iframeWin._eidosIframeScale || 1);
            
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

            // For mousemove/mouseup always dispatch on the document so editor.js
            // document-level listeners fire regardless of which element is under cursor.
            // For mousedown, dispatch on the specific target for correct hit-testing.
            const dispatchTarget = (type === 'mousedown')
                ? (dragTarget || iframeDoc.body)
                : iframeDoc;
            dispatchTarget.dispatchEvent(mouseEvent);

            if (type === 'mouseup') {
                dragTarget = null;
            }

            // Prevent scroll/gesture interference while dragging or resizing
            if (dragTarget && dragTarget !== iframeDoc.body && dragTarget !== iframeDoc.documentElement) {
                if (e && e.cancelable) e.preventDefault();
            }
        }

        // ── Transparent capture overlay (over the iframe in the parent DOM) ────────
        // Sits above the iframe in z-order so ALL touches on the slide area hit this
        // div — no cross-frame event routing needed.
        //
        // Single-touch gesture state machine:
        //   'pending'       — touch just started, waiting to classify (< MOVE_THRESHOLD)
        //   'slide-swipe'   — horizontal swipe detected (zoom=1), will navigate on end
        //   'longpress-drag'— long press fired, forwarding mouse drag events
        //   'pan'           — view pan (zoom>1, or vertical swipe)
        //   'none'          — gesture cancelled / unrecognised, eat touches silently
        const overlay = document.getElementById('touch-capture-overlay');
        if (overlay) {
            const LONG_PRESS_MS  = 180;  // Reduced: 320→180ms for snappier drag activation
            const MOVE_THRESHOLD = 10;
            const SWIPE_MIN      = 40;

            let mode = null;            // current gesture mode (strings above)
            let longPressTimer = null;
            let touchOriginX = 0, touchOriginY = 0;
            let pendingTouchCoords = null; // stored for longpress synthetic mousedown

            function cancelLP() {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            }

            // Check if the touch point (in iframe-internal coords) is over the active selection box.
            // If so, we can skip long-press and drag immediately.
            function isTouchOnSelectedElement(relX, relY) {
                const iframe = document.getElementById('preview-iframe');
                if (!iframe) return false;
                const iframeDoc = iframe.contentDocument;
                if (!iframeDoc) return false;
                const selBox = iframeDoc.querySelector('.eidos-selection-box');
                if (!selBox || selBox.style.display === 'none') return false;
                const r = selBox.getBoundingClientRect();
                // getBoundingClientRect inside iframe is in iframe viewport coords
                return relX >= r.left && relX <= r.right && relY >= r.top && relY <= r.bottom;
            }

            // Get iframe-internal coords from a touch event (or override coords)
            function getTouchIframeCoords(touch) {
                const iframe = document.getElementById('preview-iframe');
                if (!iframe) return null;
                const rect = iframe.getBoundingClientRect();
                const scale = rect.width > 0 ? rect.width / 1122 : 1;
                return {
                    relX: (touch.clientX - rect.left) / scale,
                    relY: (touch.clientY - rect.top) / scale
                };
            }

            overlay.addEventListener('touchstart', (e) => {
                if (e.touches.length > 1) {
                    // Multi-touch: abort everything, let document-level pinch take over.
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

                if (window._eidos_mobile_zoom > 1) {
                    // Zoomed: always pan, never drag elements (avoids accidental selection).
                    mode = 'pan';
                    panState = {
                        startX: t.clientX,  startY: t.clientY,
                        startPanX: window._eidos_pan.x, startPanY: window._eidos_pan.y,
                        moved: false
                    };
                } else {
                    // Check if touching an already-selected element → start drag immediately
                    const coords = getTouchIframeCoords(t);
                    if (coords && isTouchOnSelectedElement(coords.relX, coords.relY)) {
                        mode = 'longpress-drag';
                        mapTouchToMouse(null, 'mousedown', pendingTouchCoords);
                        // Haptic pulse so user knows drag mode is active
                        if (navigator.vibrate) navigator.vibrate(30);
                    } else {
                        mode = 'pending';
                        // Start long-press countdown for element dragging.
                        longPressTimer = setTimeout(() => {
                            longPressTimer = null;
                            if (mode !== 'pending') return;
                            mode = 'longpress-drag';
                            mapTouchToMouse(null, 'mousedown', pendingTouchCoords);
                            if (navigator.vibrate) navigator.vibrate(40);
                        }, LONG_PRESS_MS);
                    }
                }
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            overlay.addEventListener('touchmove', (e) => {
                if (e.touches.length > 1) return; // handled by document-level pinch
                const t = e.touches[0];
                const dx = t.clientX - touchOriginX;
                const dy = t.clientY - touchOriginY;
                const dist = Math.hypot(dx, dy);

                // ── Pan mode (zoom > 1) ──────────────────────────────────────
                if (mode === 'pan' && panState) {
                    panState.moved = panState.moved || dist > MOVE_THRESHOLD;
                    window._eidos_pan.x = panState.startPanX + dx;
                    window._eidos_pan.y = panState.startPanY + dy;
                    applyZoomAndPan();
                    if (e.cancelable) e.preventDefault();
                    return;
                }

                // ── Resolve pending gesture once threshold crossed ───────────
                if (mode === 'pending' && dist > MOVE_THRESHOLD) {
                    cancelLP();
                    // Relaxed: ratio 0.8 makes horizontal swipe much easier to trigger
                    const isHoriz = Math.abs(dx) > Math.abs(dy) * 0.8;
                    mode = isHoriz ? 'slide-swipe' : 'none';
                }

                // ── Forwarding drag events ───────────────────────────────────
                if (mode === 'longpress-drag') {
                    mapTouchToMouse(e, 'mousemove');
                    if (e.cancelable) e.preventDefault();
                    return;
                }

                // All other modes: eat the move silently.
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            let lastTapTime = 0;
            let lastTapCoords = null;

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
                    if (dx < -SWIPE_MIN && window.eidosNextSlide) window.eidosNextSlide();
                    else if (dx > SWIPE_MIN && window.eidosPrevSlide)  window.eidosPrevSlide();
                    return;
                }

                if (prevMode === 'longpress-drag') {
                    mapTouchToMouse(e, 'mouseup');
                    return;
                }

                if (prevMode === 'pending') {
                    // Normal tap: send a quick click (mousedown then mouseup).
                    mapTouchToMouse(e, 'mousedown', pendingTouchCoords);
                    setTimeout(() => mapTouchToMouse(e, 'mouseup', pendingTouchCoords), 20);

                    // Double-tap detection → fire dblclick so text editing activates
                    const now = Date.now();
                    const tapX = pendingTouchCoords.clientX;
                    const tapY = pendingTouchCoords.clientY;
                    const isDoubleTap = (now - lastTapTime < 350) &&
                        lastTapCoords &&
                        Math.hypot(tapX - lastTapCoords.x, tapY - lastTapCoords.y) < 30;
                    lastTapTime = now;
                    lastTapCoords = { x: tapX, y: tapY };
                    if (isDoubleTap) {
                        lastTapTime = 0; // reset so triple-tap doesn't re-trigger
                        setTimeout(() => {
                            // Dispatch dblclick inside the iframe at the same position
                            const iframe = document.getElementById('preview-iframe');
                            if (!iframe) return;
                            const iframeDoc = iframe.contentDocument;
                            const iframeWin  = iframe.contentWindow;
                            if (!iframeDoc || !iframeWin) return;
                            const rect  = iframe.getBoundingClientRect();
                            const scale = rect.width > 0 ? rect.width / 1122 : 1;
                            const relX  = (tapX - rect.left) / scale;
                            const relY  = (tapY - rect.top)  / scale;
                            const tgt   = iframeDoc.elementFromPoint(relX, relY) || iframeDoc.body;
                            tgt.dispatchEvent(new MouseEvent('dblclick', {
                                clientX: relX, clientY: relY,
                                bubbles: true, cancelable: true,
                                view: iframeWin
                            }));
                        }, 30);
                    }
                    return;
                }

                // 'none' or fallback
                if (dragTarget) mapTouchToMouse(e, 'mouseup');
            }, { passive: false });

            overlay.addEventListener('touchcancel', (e) => {
                cancelLP();
                panState = null;
                mode = null;
                if (dragTarget) { mapTouchToMouse(e, 'mouseup'); dragTarget = null; }
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

        // ── Minimap touch scroll ──────────────────────────────────────────────
        // The minimap uses CSS translateY() to center the active slide. On mobile
        // we add a touch-pan so users can scroll through the list directly.
        (function initMinimapTouchScroll() {
            const minimapEl = document.getElementById('editor-minimap');
            const listEl    = document.getElementById('minimap-list');
            if (!minimapEl || !listEl) return;

            let scrollStartY      = null;
            let scrollStartOffset = 0;

            function getCurrentOffsetY() {
                const t = listEl.style.transform || '';
                const m = t.match(/translateY\((-?[\d.]+)px\)/);
                return m ? parseFloat(m[1]) : 0;
            }

            function clampOffset(y) {
                // Never push list so far down that the first item is below center
                const maxY = minimapEl.clientHeight / 2;
                // Never pull list so far up that the last item is above center
                const minY = -(Math.max(0, listEl.scrollHeight - minimapEl.clientHeight / 2));
                return Math.max(minY, Math.min(maxY, y));
            }

            minimapEl.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                scrollStartY      = e.touches[0].clientY;
                scrollStartOffset = getCurrentOffsetY();
                // Snap off any centering transition so it responds instantly
                listEl.style.transition = 'none';
                e.stopPropagation();
            }, { passive: true });

            minimapEl.addEventListener('touchmove', (e) => {
                if (scrollStartY === null || e.touches.length !== 1) return;
                const dy = e.touches[0].clientY - scrollStartY;
                listEl.style.transform = `translateY(${clampOffset(scrollStartOffset + dy)}px)`;
                e.stopPropagation();
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            minimapEl.addEventListener('touchend', () => {
                scrollStartY = null;
                // Restore smooth transition for subsequent auto-centering on slide click
                listEl.style.transition = 'transform 380ms cubic-bezier(0.4, 0, 0.2, 1)';
            }, { passive: true });
        })();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileBridge);
    } else {
        initMobileBridge();
    }
})();
