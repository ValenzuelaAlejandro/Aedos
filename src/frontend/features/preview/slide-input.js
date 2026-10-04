(function registerSlideInputHandlers(global) {
    'use strict';

    /**
     * @typedef {Object} SlideInputDependencies
     * @property {HTMLElement} previewContainer Existing preview container.
     * @property {Object} previewState Current slide and total count.
     * @property {Object} navigationState Existing navigation state.
     * @property {(index: number) => boolean} tryNavigate Existing cooldown navigation.
     * @property {Object} uiLog Existing logger.
     */

    /** Register keyboard, wheel, and swipe listeners at their existing app position. @param {SlideInputDependencies} deps */
    // eslint-disable-next-line max-lines-per-function -- Preserve the existing event handlers and registration order as one block.
    function createSlideInputHandlers({ previewContainer, previewState, navigationState, tryNavigate, uiLog }) {
        // Keyboard arrow navigation for slides
        function handleSlideKeyboardNav(e) {
            if (previewContainer.classList.contains('hidden')) return;
            // Don't capture arrows when user is typing in an input/textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

            // Skip if editor has a selected element
            try {
                const iframe = document.getElementById('preview-iframe');
                const iframeWin = iframe.contentWindow;
                if (iframeWin && iframeWin.editorGetSelection && iframeWin.editorGetSelection()) {
                    // If an element is selected, let the editor handle arrows (moving elements)
                    return;
                }
                // eslint-disable-next-line no-empty -- Match the existing best-effort editor selection probe.
            } catch (err) { }

            if (e.key === 'ArrowLeft') {
                if (tryNavigate(previewState.currentSlide - 1)) e.preventDefault();
            } else if (e.key === 'ArrowRight') {
                if (tryNavigate(previewState.currentSlide + 1)) e.preventDefault();
            }
        }
        // Global keyboard shortcut forwarding to the editor iframe
        // This ensures Ctrl+C, Ctrl+V, and Ctrl+D work even if focus is on parent UI (header, minimap)
        // eslint-disable-next-line complexity -- Preserve the existing shortcut forwarding conditions.
        function handleGlobalShortcuts(e) {
            if (previewContainer.classList.contains('hidden')) return;

            // Skip if user is typing in a real input/textarea in the parent
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Skip if in fullscreen (presentation mode)
            if (document.fullscreenElement || document.webkitFullscreenElement) return;

            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === 'c' || key === 'v' || key === 'd' || key === 'x' || key === 'z' || key === 'y') {
                    try {
                        const iframe = document.getElementById('preview-iframe');
                        const iframeWin = iframe.contentWindow;

                        // Check if an element is selected in the editor
                        if (iframeWin && iframeWin.editorGetSelection && iframeWin.editorGetSelection()) {
                            // Forward the event to the iframe
                            const event = new KeyboardEvent('keydown', {
                                key: e.key,
                                ctrlKey: e.ctrlKey,
                                metaKey: e.metaKey,
                                shiftKey: e.shiftKey,
                                altKey: e.altKey,
                                bubbles: true
                            });
                            iframeWin.dispatchEvent(event);

                            // Prevent the default parent action (like Ctrl+D bookmarking or Ctrl+C copying empty parent)
                            e.preventDefault();
                        }
                    } catch (err) {
                        uiLog.error('EDITOR', 'Error forwarding keyboard shortcut to iframe', {
                            error: err
                        });
                    }
                }
            }
        }
        document.addEventListener('keydown', handleGlobalShortcuts, true); // useCapture to intercept before others

        document.addEventListener('keydown', handleSlideKeyboardNav);

        // Mouse wheel navigation for slides
        navigationState.wheelCooldown = false;
        function handleSlideWheelNav(e) {
            if (previewContainer.classList.contains('hidden')) return;
            if (navigationState.wheelCooldown) return;

            // Ignore small/accidental/slow inertial wheel events
            const dx = Math.abs(e.deltaX);
            const dy = Math.abs(e.deltaY);
            if (dx < 30 && dy < 30) return;

            let navigated = false;
            if (dy > dx) {
                if (e.deltaY > 0) {
                    navigated = tryNavigate(previewState.currentSlide + 1);
                } else if (e.deltaY < 0) {
                    navigated = tryNavigate(previewState.currentSlide - 1);
                }
            } else {
                if (e.deltaX > 0) {
                    navigated = tryNavigate(previewState.currentSlide + 1);
                } else if (e.deltaX < 0) {
                    navigated = tryNavigate(previewState.currentSlide - 1);
                }
            }

            if (navigated) {
                navigationState.wheelCooldown = true;
                setTimeout(() => {
                    navigationState.wheelCooldown = false;
                }, 600); // 600ms cooldown is perfect to absorb trackpad/mouse swipe inertia
            }
        }
        document.addEventListener('wheel', handleSlideWheelNav, { passive: true });

        // Mobile Swipe Support
        const mobileSwipeHandlers =
            window.MobileRuntime && typeof window.MobileRuntime.createSlideSwipeHandlers === 'function'
                ? window.MobileRuntime.createSlideSwipeHandlers({
                    threshold: 50,
                    getCurrentSlide: () => previewState.currentSlide,
                    getTotalSlides: () => previewState.totalSlides,
                    onNavigate: (nextSlide) => tryNavigate(nextSlide)
                })
                : null;

        navigationState.touchStartX = 0;
        navigationState.touchEndX = 0;

        function handleTouchStart(e) {
            if (mobileSwipeHandlers) {
                mobileSwipeHandlers.onTouchStart(e);
                return;
            }
            navigationState.touchStartX = e.changedTouches[0].screenX;
        }

        function handleTouchEnd(e) {
            if (mobileSwipeHandlers) {
                mobileSwipeHandlers.onTouchEnd(e);
                return;
            }
            navigationState.touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }

        function handleSwipe() {
            const threshold = 50;
            if (navigationState.touchEndX < navigationState.touchStartX - threshold) {
                // Swipe Left -> Next
                tryNavigate(previewState.currentSlide + 1);
            } else if (navigationState.touchEndX > navigationState.touchStartX + threshold) {
                // Swipe Right -> Prev
                tryNavigate(previewState.currentSlide - 1);
            }
        }
        return { handleSlideWheelNav, handleTouchStart, handleTouchEnd };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createSlideInputHandlers = createSlideInputHandlers;
})(window);
