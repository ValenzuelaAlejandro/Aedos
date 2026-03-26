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

        function mapTouchToMouse(e, type) {
            // Allow native pinch zoom (multi-touch)
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
        let initialPinchDist = 0;
        let initialZoomScale = 1;

        const getPinchDist = (e) => {
            if (e.touches && e.touches.length === 2) {
                return Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
            return 0;
        };

        const handleZoomStart = (e) => {
            if (e.touches && e.touches.length === 2) {
                initialPinchDist = getPinchDist(e);
                const matrix = new DOMMatrix(getComputedStyle(previewIframe).transform);
                initialZoomScale = matrix.a || 1;
            }
        };

        const handleZoomMove = (e) => {
            if (e.touches && e.touches.length === 2 && initialPinchDist > 0) {
                const dist = getPinchDist(e);
                const zoomFactor = dist / initialPinchDist;
                let newScale = initialZoomScale * zoomFactor;
                newScale = Math.min(Math.max(newScale, 0.3), 3.0);
                if (window.eidosSetZoom) window.eidosSetZoom(newScale);
                if (e.cancelable) e.preventDefault();
            }
        };

        const bindEvents = (element) => {
            if (!element) return;
            element.addEventListener('touchstart', (e) => {
                // Ignore multi-touch to let native zoom handle it
                if (e.touches && e.touches.length > 1) return;
                mapTouchToMouse(e, 'mousedown');
            }, { passive: true });

            element.addEventListener('touchmove', (e) => {
                if (e.touches && e.touches.length > 1) return;
                if (dragTarget) mapTouchToMouse(e, 'mousemove');
            }, { passive: true });

            element.addEventListener('touchend', (e) => {
                mapTouchToMouse(e, 'mouseup');
            }, { passive: true });

            element.addEventListener('touchcancel', (e) => {
                mapTouchToMouse(e, 'mouseup');
            }, { passive: true });
        };

        // Bind for single-touch editing while allowing native zoom
        bindEvents(stage);
        previewIframe.addEventListener('load', () => {
            if (previewIframe.contentDocument) bindEvents(previewIframe.contentDocument);
        });
        if (previewIframe.contentDocument) bindEvents(previewIframe.contentDocument);
        
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
