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

        // ── Pinch-to-zoom (custom, prevents native browser zoom sticking) ──
        window._eidos_mobile_zoom = window._eidos_mobile_zoom || 1;
        let pinchState = null;

        function getPinchDist(touches) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.hypot(dx, dy);
        }

        function applyPinchZoom(mobileZoom) {
            window._eidos_mobile_zoom = mobileZoom;
            const iframe = document.getElementById('preview-iframe');
            const wrapper = document.querySelector('.preview-wrapper');
            if (!iframe || !wrapper) return;
            const baseScale = window._eidosBaseScale || 1;
            const totalScale = baseScale * mobileZoom;
            iframe.style.transform = `scale(${totalScale})`;
            wrapper.style.height = `${631 * totalScale}px`;
            wrapper.style.width = `${1122 * totalScale}px`;
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
            stage.addEventListener('touchstart', (e) => {
                if (e.target.closest('#mobile-bottom-nav') || e.target.closest('.editor-tools-panel') || e.target.closest('.editor-minimap')) {
                    return;
                }
                if (e.touches.length === 2) {
                    // Start custom pinch — prevent native browser zoom
                    e.preventDefault();
                    pinchState = {
                        startDist: getPinchDist(e.touches),
                        startZoom: window._eidos_mobile_zoom || 1
                    };
                    return;
                }
                mapTouchToMouse(e, 'mousedown');
            }, { passive: false });

            stage.addEventListener('touchmove', (e) => {
                if (e.touches.length === 2 && pinchState) {
                    e.preventDefault();
                    const dist = getPinchDist(e.touches);
                    const ratio = dist / pinchState.startDist;
                    const newZoom = Math.max(0.25, Math.min(3, pinchState.startZoom * ratio));
                    applyPinchZoom(newZoom);
                    return;
                }
                if (dragTarget) mapTouchToMouse(e, 'mousemove');
            }, { passive: false });

            stage.addEventListener('touchend', (e) => {
                if (pinchState && e.touches.length < 2) {
                    pinchState = null;
                    return;
                }
                if (dragTarget) mapTouchToMouse(e, 'mouseup');
            }, { passive: false });
            
            stage.addEventListener('touchcancel', (e) => {
                pinchState = null;
                if (dragTarget) mapTouchToMouse(e, 'mouseup');
            }, { passive: false });
        }
        
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
