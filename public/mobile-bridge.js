/**
 * Eidoslab Mobile Bridge
 * Maps touch events to mouse events to enable editor interactivity on mobile
 * without modifying the core desktop-focused editor.js.
 */
(function() {
    function initMobileBridge() {
        const isMobile = () => window.innerWidth < 768 && window.innerHeight > window.innerWidth;
        
        const previewIframe = document.getElementById('preview-iframe');
        if (!previewIframe) return;

        function mapTouchToMouse(e, type) {
            if (!isMobile()) return;
            
            const touch = e.touches[0] || e.changedTouches[0];
            if (!touch) return;

            // Target the actual element inside the iframe if possible
            const iframeDoc = previewIframe.contentDocument;
            if (!iframeDoc) return;

            // We need to calculate coordinates relative to the iframe's internal layout
            const rect = previewIframe.getBoundingClientRect();
            const scale = window._eidosIframeScale || 1;
            
            // Coordinates relative to the iframe top-left
            const relX = (touch.clientX - rect.left) / scale;
            const relY = (touch.clientY - rect.top) / scale;

            const mouseEvent = new MouseEvent(type, {
                clientX: touch.clientX,
                clientY: touch.clientY,
                screenX: touch.screenX,
                screenY: touch.screenY,
                bubbles: true,
                cancelable: true,
                view: window,
                buttons: 1
            });

            // Dispatch to the element inside the iframe's body at that point
            const targetEl = iframeDoc.elementFromPoint(relX, relY) || iframeDoc.body;
            targetEl.dispatchEvent(mouseEvent);

            // Also dispatch to the iframe's document for global listeners in editor.js
            iframeDoc.dispatchEvent(mouseEvent);

            // Prevent default browser behavior (scroll/zoom) during interaction
            if (e.cancelable) e.preventDefault();
        }

        // Parent-side touch handlers on the iframe container
        const stage = document.getElementById('preview-stage');
        if (stage) {
            stage.addEventListener('touchstart', (e) => mapTouchToMouse(e, 'mousedown'), { passive: false });
            stage.addEventListener('touchmove', (e) => mapTouchToMouse(e, 'mousemove'), { passive: false });
            stage.addEventListener('touchend', (e) => mapTouchToMouse(e, 'mouseup'), { passive: false });
        }
        
        // Mobile UI Interaction Logic
        const mobileOverlay = document.getElementById('mobile-overlay');
        const minimap = document.getElementById('editor-minimap');
        const toolsPanel = document.getElementById('editor-tools-panel');

        window.toggleMobileDrawer = (type) => {
            if (type === 'minimap') {
                minimap.classList.toggle('open');
                toolsPanel.classList.remove('open');
                mobileOverlay.classList.toggle('visible', minimap.classList.contains('open'));
            } else if (type === 'tools') {
                toolsPanel.classList.toggle('open');
                minimap.classList.remove('open');
                mobileOverlay.classList.toggle('visible', toolsPanel.classList.contains('open'));
            } else if (type === 'canvas') {
                minimap.classList.remove('open');
                toolsPanel.classList.remove('open');
                mobileOverlay.classList.remove('visible');
            }

            // Update active state on nav buttons
            document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
                const btnType = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
                btn.classList.toggle('active', btnType === type);
            });
        };

        if (mobileOverlay) {
            mobileOverlay.addEventListener('click', () => {
                minimap.classList.remove('open');
                toolsPanel.classList.remove('open');
                mobileOverlay.classList.remove('visible');
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileBridge);
    } else {
        initMobileBridge();
    }
})();
