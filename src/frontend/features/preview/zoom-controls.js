(function registerZoomControls(global) {
    'use strict';

    /**
     * Register preview zoom controls at the page's original initialization point.
     * @param {{MOBILE_BREAKPOINT: number, resetMobileZoomState: Function}} deps
     * @returns {{zoomState: Object, syncZoomStateWithViewportMode: Function, updateZoomDisplay: Function, setZoom: Function}}
     */
    function createZoomControls({ MOBILE_BREAKPOINT, resetMobileZoomState }) {
        // Initialize zoom state
        window._manualZoomScale = 1.0; // Manual zoom factor (1.0 = fill available area; panels reserve space via stage padding)
        const zoomState = {
            min: 0.5, // 50%
            max: 2, // 200%
            step: 0.1, // 10% increments
            fallbackLastIsMobileLayout: window.innerWidth <= MOBILE_BREAKPOINT
        };
        const syncZoomStateWithViewportMode =
            window.MobileRuntime && typeof window.MobileRuntime.createViewportModeSync === 'function'
                ? window.MobileRuntime.createViewportModeSync({ onLeaveMobile: resetMobileZoomState })
                : function syncZoomStateWithViewportModeFallback() {
                    const isMobileLayout = window.innerWidth <= MOBILE_BREAKPOINT;
                    if (zoomState.fallbackLastIsMobileLayout && !isMobileLayout) {
                        resetMobileZoomState();
                    }
                    zoomState.fallbackLastIsMobileLayout = isMobileLayout;
                    return isMobileLayout;
                };

        function updateZoomDisplay() {
            const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
            const maxZoom = isFullscreen ? zoomState.max : 1;
            const minZoom = zoomState.min;
            const EPS = 0.0001;
            const display = document.getElementById('canvas-zoom-display');
            if (display) {
                const percentage = Math.round(window._manualZoomScale * 100);
                display.textContent = `${percentage}%`;
            }
            if (btnZoomIn) btnZoomIn.disabled = window._manualZoomScale >= (maxZoom - EPS);
            if (btnZoomOut) btnZoomOut.disabled = window._manualZoomScale <= (minZoom + EPS);
        }

        function setZoom(zoomLevel) {
            const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
            const maxZoom = isFullscreen ? zoomState.max : 1;
            zoomLevel = Math.max(zoomState.min, Math.min(maxZoom, zoomLevel));
            window._manualZoomScale = zoomLevel;
            updateZoomDisplay();
            window.dispatchEvent(new Event('resize'));
        }

        // Zoom button handlers
        const btnZoomIn = document.getElementById('btn-zoom-in');
        const btnZoomOut = document.getElementById('btn-zoom-out');

        if (btnZoomIn) {
            btnZoomIn.addEventListener('click', () => {
                setZoom(window._manualZoomScale + zoomState.step);
            });
        }

        if (btnZoomOut) {
            btnZoomOut.addEventListener('click', () => {
                setZoom(window._manualZoomScale - zoomState.step);
            });
        }

        // Ensure initial display matches the new default
        updateZoomDisplay();
        return { zoomState, syncZoomStateWithViewportMode, updateZoomDisplay, setZoom };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createZoomControls = createZoomControls;
})(window);
