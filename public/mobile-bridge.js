/**
 * Eidoslab Mobile Bridge v14
 * 
 * Simplified mobile experience:
 * - Read-only presentation with swipe navigation
 * - Double-tap to edit text
 * - Tap image slots to upload
 * - Pinch to zoom
 * 
 * No drag, no resize, no complex gestures.
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
        }

        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickStr.includes(`'${type}'`));
        });
    };

    function initMobileBridge() {
        const isMobile = () => window.innerWidth < 850;
        if (!isMobile()) return;

        const iframe = document.getElementById('preview-iframe');
        const overlay = document.getElementById('touch-capture-overlay');
        
        if (!iframe || !overlay) return;

        // ─────────────────────────────────────────────────────────────────
        // PINCH-TO-ZOOM (document-level, works across iframe boundary)
        // ─────────────────────────────────────────────────────────────────
        window._eidos_mobile_zoom = window._eidos_mobile_zoom || 1;
        window._eidos_pan = window._eidos_pan || { x: 0, y: 0 };
        let pinchState = null;

        function getPinchDist(touches) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.hypot(dx, dy);
        }

        function applyZoomAndPan() {
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

        document.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 2) {
                pinchState = null;
                return;
            }
            // Exclude tooling UI — allow pinch on slide area
            const t0 = e.touches[0];
            if (t0.target && t0.target.closest('#mobile-bottom-nav, .editor-tools-panel, .editor-minimap')) {
                pinchState = null;
                return;
            }
            e.preventDefault();
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

        // ─────────────────────────────────────────────────────────────────
        // SLIDE NAVIGATION: Swipe + Double-tap text editing
        // ─────────────────────────────────────────────────────────────────
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let lastTapTime = 0;
        let lastTapCoords = null;

        overlay.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1 || !pinchState) return; // Let pinch take over
            
            const t = e.touches[0];
            touchStartX = t.clientX;
            touchStartY = t.clientY;
            touchStartTime = Date.now();
        }, { passive: true });

        overlay.addEventListener('touchend', (e) => {
            const t = e.changedTouches[0];
            if (!t) return;

            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            const dist = Math.hypot(dx, dy);
            const elapsed = Date.now() - touchStartTime;

            // Swipe to navigate (only if NOT pinched-in)
            if (window._eidos_mobile_zoom <= 1 && dist > 40 && elapsed < 500) {
                const isHoriz = Math.abs(dx) > Math.abs(dy);
                if (isHoriz) {
                    if (dx < -40 && window.eidosNextSlide) window.eidosNextSlide();
                    else if (dx > 40 && window.eidosPrevSlide) window.eidosPrevSlide();
                }
                return;
            }

            // Tap: Check for double-tap or image slot selection
            if (dist < 10 && elapsed < 300) {
                const now = Date.now();
                const isDoubleTap = (now - lastTapTime < 300) &&
                    lastTapCoords &&
                    Math.hypot(t.clientX - lastTapCoords.x, t.clientY - lastTapCoords.y) < 20;
                
                lastTapTime = now;
                lastTapCoords = { x: t.clientX, y: t.clientY };

                // Hit test inside iframe
                const rect = iframe.getBoundingClientRect();
                const scale = rect.width > 0 ? rect.width / 1122 : 1;
                const relX = (t.clientX - rect.left) / scale;
                const relY = (t.clientY - rect.top) / scale;

                const iframeDoc = iframe.contentDocument;
                if (!iframeDoc) return;

                const target = iframeDoc.elementFromPoint(relX, relY);
                if (!target) return;

                // Image slot: trigger picker
                if (target.classList.contains('img-slot') || target.closest('.img-slot')) {
                    const slot = target.classList.contains('img-slot') ? target : target.closest('.img-slot');
                    if (window.parent && window.parent._eidosTriggerImagePicker) {
                        window.parent._eidosTriggerImagePicker(slot);
                    }
                    return;
                }

                // Text: double-tap to edit
                if (isDoubleTap) {
                    lastTapTime = 0;
                    const textTarget = target.closest('h1, h2, h3, h4, p, span, blockquote, .tag');
                    if (textTarget) {
                        // Dispatch dblclick to trigger editor.js text editing
                        textTarget.dispatchEvent(new MouseEvent('dblclick', {
                            bubbles: true,
                            cancelable: true,
                            view: iframe.contentWindow,
                            clientX: relX,
                            clientY: relY
                        }));
                    }
                }
            }
        }, { passive: true });

        // ─────────────────────────────────────────────────────────────────
        // MINIMAP TOUCH SCROLL
        // ─────────────────────────────────────────────────────────────────
        (function initMinimapTouchScroll() {
            const minimapEl = document.getElementById('editor-minimap');
            const listEl = document.getElementById('minimap-list');
            if (!minimapEl || !listEl) return;

            let scrollStartY = null;
            let scrollStartOffset = 0;

            function getCurrentOffsetY() {
                const t = listEl.style.transform || '';
                const m = t.match(/translateY\((-?[\d.]+)px\)/);
                return m ? parseFloat(m[1]) : 0;
            }

            function clampOffset(y) {
                const maxY = minimapEl.clientHeight / 2;
                const minY = -(Math.max(0, listEl.scrollHeight - minimapEl.clientHeight / 2));
                return Math.max(minY, Math.min(maxY, y));
            }

            minimapEl.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                scrollStartY = e.touches[0].clientY;
                scrollStartOffset = getCurrentOffsetY();
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
