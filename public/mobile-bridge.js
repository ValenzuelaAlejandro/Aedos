/**
 * Eidoslab Mobile Bridge
 * Maps touch events to mouse events to enable editor interactivity on mobile
 * without modifying the core desktop-focused editor.js.
 * 
 * Version v=8 - FIXED DRAG, RESIZE, AND DRAWER RELIABILITY
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

        const previewIframe = document.getElementById('preview-iframe');
        if (!previewIframe) return;

        let dragTarget = null;

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
        // ────────────────────────────────────────────────────────────────────

        function mapTouchToMouse(e, type) {
            // Multi-touch is handled by the pinch zoom system above
            if (e.touches && e.touches.length > 1) return;

            const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
            if (!touch) return;

            const iframeDoc = previewIframe.contentDocument;
            const iframeWin = previewIframe.contentWindow;
            if (!iframeDoc || !iframeWin) return;

            const rect = previewIframe.getBoundingClientRect();
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

        const stage = document.getElementById('preview-stage');
        if (stage) {
            // Single-touch only: drag / resize elements inside the iframe.
            // 2-finger pinch+pan is handled at document level below.
            stage.addEventListener('touchstart', (e) => {
                if (e.target.closest('#mobile-bottom-nav') || e.target.closest('.editor-tools-panel') || e.target.closest('.editor-minimap')) {
                    return;
                }
                if (e.touches.length > 1) {
                    // Second finger added: cancel any in-progress drag cleanly.
                    if (dragTarget) { mapTouchToMouse(e, 'mouseup'); dragTarget = null; }
                    return;
                }
                mapTouchToMouse(e, 'mousedown');
            }, { passive: false });

            stage.addEventListener('touchmove', (e) => {
                if (e.touches.length > 1) return; // handled by document-level pinch+pan
                if (dragTarget) mapTouchToMouse(e, 'mousemove');
            }, { passive: false });

            stage.addEventListener('touchend', (e) => {
                if (dragTarget) mapTouchToMouse(e, 'mouseup');
            }, { passive: false });

            stage.addEventListener('touchcancel', (e) => {
                if (dragTarget) mapTouchToMouse(e, 'mouseup');
            }, { passive: false });
        }

        // ── Document-level 2-finger pinch + pan ───────────────────────────────
        // Works inside the iframe area because document-level touchstart fires
        // for every touch regardless of which frame's content was touched.
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 2) return;
            const stageEl = document.getElementById('preview-stage');
            if (!stageEl) return;
            // Must originate inside the canvas stage, not on panel UI
            const t0 = e.touches[0];
            if (t0.target && t0.target.closest('#mobile-bottom-nav, .editor-tools-panel, .editor-minimap')) return;
            const sr = stageEl.getBoundingClientRect();
            if (t0.clientX < sr.left || t0.clientX > sr.right || t0.clientY < sr.top || t0.clientY > sr.bottom) return;
            e.preventDefault();
            if (dragTarget) { dragTarget = null; } // cancel any in-progress single-touch drag
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            pinchState = {
                startDist: getPinchDist(e.touches),
                startZoom: window._eidos_mobile_zoom || 1,
                lastMidX: midX,
                lastMidY: midY
            };
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!pinchState || e.touches.length !== 2) return;
            e.preventDefault();
            const dist = getPinchDist(e.touches);
            const ratio = dist / pinchState.startDist;
            window._eidos_mobile_zoom = Math.max(0.5, Math.min(3, pinchState.startZoom * ratio));
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            window._eidos_pan.x += midX - pinchState.lastMidX;
            window._eidos_pan.y += midY - pinchState.lastMidY;
            pinchState.lastMidX = midX;
            pinchState.lastMidY = midY;
            applyZoomAndPan();
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
