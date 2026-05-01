(function () {
    const cfg = window.MobileConfig || {
        breakpoint: 850,
        modeTouchDebounceMs: 700,
        modeSelectionDebounceMs: 250,
        swipeThreshold: 50
    };

    const MOBILE_LOADING_KEYS = [
        'gen_loading_1_mobile', 'gen_loading_2_mobile', 'gen_loading_3_mobile', 'gen_loading_4_mobile',
        'gen_loading_5_mobile', 'gen_loading_6_mobile', 'gen_loading_7_mobile', 'gen_loading_8_mobile',
        'gen_loading_9_mobile', 'gen_loading_final_mobile'
    ];

    function isMobileLayout() {
        return window.innerWidth <= cfg.breakpoint;
    }

    function resetZoomState() {
        window._mobile_zoom = 1;
        window._pan = { x: 0, y: 0 };
    }

    function resolveLoadingKeys(desktopKeys) {
        return isMobileLayout() ? MOBILE_LOADING_KEYS : desktopKeys;
    }

    function createViewportModeSync(options = {}) {
        const onLeaveMobile = typeof options.onLeaveMobile === 'function' ? options.onLeaveMobile : null;
        let lastIsMobile = isMobileLayout();

        return function syncViewportMode() {
            const mobileNow = isMobileLayout();
            if (lastIsMobile && !mobileNow && onLeaveMobile) {
                onLeaveMobile();
            }
            lastIsMobile = mobileNow;
            return mobileNow;
        };
    }

    function createSlideSwipeHandlers(options = {}) {
        const threshold = Number.isFinite(options.threshold) ? options.threshold : cfg.swipeThreshold;
        const getCurrentSlide = typeof options.getCurrentSlide === 'function' ? options.getCurrentSlide : () => 0;
        const getTotalSlides = typeof options.getTotalSlides === 'function' ? options.getTotalSlides : () => 0;
        const onNavigate = typeof options.onNavigate === 'function' ? options.onNavigate : () => {};

        let touchStartX = 0;

        function onTouchStart(e) {
            if (!e || !e.changedTouches || !e.changedTouches[0]) return;
            touchStartX = e.changedTouches[0].screenX;
        }

        function onTouchEnd(e) {
            if (!e || !e.changedTouches || !e.changedTouches[0]) return;
            const touchEndX = e.changedTouches[0].screenX;
            const currentSlide = getCurrentSlide();
            const totalSlides = getTotalSlides();

            if (touchEndX < touchStartX - threshold) {
                if (currentSlide < totalSlides - 1) onNavigate(currentSlide + 1);
            } else if (touchEndX > touchStartX + threshold) {
                if (currentSlide > 0) onNavigate(currentSlide - 1);
            }
        }

        return { onTouchStart, onTouchEnd };
    }

    function blurFocusedTextControl() {
        const activeEl = document.activeElement;
        if (!activeEl) return;
        const isTextControl =
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'INPUT' ||
            activeEl.isContentEditable;
        if (isTextControl && typeof activeEl.blur === 'function') {
            activeEl.blur();
        }
    }

    window.MobileRuntime = Object.assign(window.MobileRuntime || {}, {
        isMobileLayout,
        resetZoomState,
        resolveLoadingKeys,
        createViewportModeSync,
        createSlideSwipeHandlers
    });
})();
