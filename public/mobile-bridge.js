/**
 * Eidoslab Mobile Bridge
 * Maps touch events to mouse events to enable editor interactivity on mobile
 * without modifying the core desktop-focused editor.js.
 */
(function() {
    function initMobileBridge() {
        const isMobile = () => window.innerWidth < 850;
        
        const previewIframe = document.getElementById('preview-iframe');
        if (!previewIframe) return;

        let dragTarget = null;

        function mapTouchToMouse(e, type) {
            if (!isMobile()) return;
            
            // Allow native pinch zoom (multi-touch)
            if (e.touches.length > 1) return;

            const touch = e.touches[0] || e.changedTouches[0];
            if (!touch) return;

            const iframeDoc = previewIframe.contentDocument;
            const iframeWin = previewIframe.contentWindow;
            if (!iframeDoc || !iframeWin) return;

            const rect = previewIframe.getBoundingClientRect();
            const scale = window._eidosIframeScale || 1;
            
            const relX = (touch.clientX - rect.left) / scale;
            const relY = (touch.clientY - rect.top) / scale;

            // CRITICAL: We dispatch inside the iframe, 
            // so clientX/clientY MUST be relative to the iframe's internal coordinate system!
            const mouseEvent = new MouseEvent(type, {
                clientX: relX,
                clientY: relY,
                screenX: touch.screenX,
                screenY: touch.screenY,
                bubbles: true,
                cancelable: true,
                view: iframeWin,
                buttons: 1,
                which: 1
            });

            if (type === 'mousedown') {
                dragTarget = iframeDoc.elementFromPoint(relX, relY) || iframeDoc.body;
            }

            const target = dragTarget || iframeDoc.body;
            target.dispatchEvent(mouseEvent);

            if (type === 'mouseup') {
                dragTarget = null;
            }

            // ONLY prevent default if we are interacting with the canvas elements
            // This allows native scrolling if touching empty space
            if (dragTarget && dragTarget !== iframeDoc.body && dragTarget !== iframeDoc.documentElement) {
                if (e.cancelable) e.preventDefault();
            }
        }

        const stage = document.getElementById('preview-stage');
        if (stage) {
            stage.addEventListener('touchstart', (e) => mapTouchToMouse(e, 'mousedown'), { passive: false });
            stage.addEventListener('touchmove', (e) => {
                if (dragTarget) mapTouchToMouse(e, 'mousemove');
            }, { passive: false });
            stage.addEventListener('touchend', (e) => mapTouchToMouse(e, 'mouseup'), { passive: false });
        }
        
        // Prevent tapping mobile UI from triggering root editor deselect in app.js
        const stopBubbling = (e) => e.stopPropagation();
        [
            document.getElementById('mobile-bottom-nav'),
            document.getElementById('editor-tools-panel'),
            document.getElementById('editor-minimap'),
            document.getElementById('mobile-overlay')
        ].forEach(node => {
            if (node) {
                node.addEventListener('mousedown', stopBubbling);
                node.addEventListener('touchstart', stopBubbling, { passive: true });
                node.addEventListener('click', stopBubbling);
            }
        });
        
        const minimap = document.getElementById('editor-minimap');
        const toolsPanel = document.getElementById('editor-tools-panel');
        const mobileOverlay = document.getElementById('mobile-overlay');

        // Ensure global access correctly
        window.toggleMobileDrawer = (type, e) => {
            console.log('toggleMobileDrawer called with type:', type);
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            if (!minimap || !toolsPanel || !mobileOverlay) {
                console.error('Mobile UI elements not found. minimap:', !!minimap, 'toolsPanel:', !!toolsPanel, 'mobileOverlay:', !!mobileOverlay);
                return;
            }

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
            }

            document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
                const onclickStr = btn.getAttribute('onclick') || '';
                btn.classList.toggle('active', onclickStr.includes(`'${type}'`));
            });
        };

        if (mobileOverlay) {
            mobileOverlay.style.pointerEvents = 'none'; // Initial state
            mobileOverlay.addEventListener('click', () => {
                if (minimap) minimap.classList.remove('open');
                if (toolsPanel) toolsPanel.classList.remove('open');
                mobileOverlay.classList.remove('visible');
                mobileOverlay.style.pointerEvents = 'none';
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileBridge);
    } else {
        initMobileBridge();
    }
})();
