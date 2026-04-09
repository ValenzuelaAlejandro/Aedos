// Eidoslab Editor UI (Left Panel & Right Panel logic)

window.initEditorUI = function (iframe) {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const iframeWin = iframe.contentWindow;

    if (!iframeDoc || !iframeDoc.body) return;
    
    function safeAddListener(id, event, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }

    // Subscriptions for keyboard navigation and duplication
    iframeWin.addEventListener('eidos-navigate-prev', () => {
        if (window.eidosPrevSlide) window.eidosPrevSlide();
    });
    iframeWin.addEventListener('eidos-navigate-next', () => {
        if (window.eidosNextSlide) window.eidosNextSlide();
    });
    iframeWin.addEventListener('eidos-duplicate-slide', () => {
        const slidesCount = iframeDoc.querySelectorAll('section[class*="s"]').length;
        if (slidesCount >= 15) return;
        if (iframeWin.eidosSaveState) iframeWin.eidosSaveState();
        if (slides.length === 0) return;
        const activeSlide = slides.find(s => s.classList.contains('active')) || slides[0];

        const newSlide = activeSlide.cloneNode(true);
        newSlide.classList.remove('active');
        activeSlide.after(newSlide);

        setTimeout(() => {
            const nextIdx = slides.indexOf(activeSlide) + 1;
            const dots = document.querySelectorAll('.slide-dot');
            if (dots.length > nextIdx) dots[nextIdx].click();
        }, 100);
    });


    // Helper to generate right panel tools based on selected element

    // --- 3. TOOLS PANEL CONTROL ---

    // --- 4. TOP BAR ACTIONS & ADD ELEMENTS ---

    safeAddListener('btn-undo', 'click', () => {
        if (iframeWin.eidosUndo) iframeWin.eidosUndo();
    });
    safeAddListener('btn-redo', 'click', () => {
        if (iframeWin.eidosRedo) iframeWin.eidosRedo();
    });

    safeAddListener('btn-present', 'click', () => {
        const stage = document.getElementById('preview-stage');
        if (stage) {
            if (stage.requestFullscreen) {
                stage.requestFullscreen();
            } else if (stage.webkitRequestFullscreen) {
                stage.webkitRequestFullscreen();
            }
        }
    });

    // Zoom Canvas - Now handled by button handlers in app.js
    // No need to reinitialize as buttons are already bound

    // Add Elements

    // Subscribe to internal slide active changes in app.js
    // Polling is a fallback for the MutationObserver to ensure smooth active state syncing
    let lastActiveSlideIndex = -1;
    if (window._eidosMinimapInterval) clearInterval(window._eidosMinimapInterval);
    window._eidosMinimapInterval = setInterval(() => {
        const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"], section'));
        const activeIdx = slides.findIndex(s => s.classList.contains('active'));
        if (activeIdx !== -1 && activeIdx !== lastActiveSlideIndex) {
            lastActiveSlideIndex = activeIdx;
            if (window.syncMinimapActiveState) window.syncMinimapActiveState(activeIdx);
        }
    }, 200);

    // Global Key Listener for Parent Window Shortcuts (Ctrl+Z / Ctrl+Y)
    const keydownHandler = (e) => {
        const container = document.getElementById('preview-container');
        if (!container || container.classList.contains('hidden')) return;

        // Prevent if editing text field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

        if (e.ctrlKey || e.metaKey) {
            const key = e.key.toLowerCase();
            if (key === 'z') {
                if (e.shiftKey) {
                    if (iframeWin.eidosRedo) iframeWin.eidosRedo();
                } else {
                    if (iframeWin.eidosUndo) iframeWin.eidosUndo();
                }
                e.preventDefault();
            } else if (key === 'y') {
                if (iframeWin.eidosRedo) iframeWin.eidosRedo();
                e.preventDefault();
            } else if (key === 'd') {
                if (!e.target.isContentEditable) {
                    e.preventDefault();
                    if (iframeWin.eidosDuplicateSelection && iframeWin.eidosGetSelection && iframeWin.eidosGetSelection()) {
                        iframeWin.eidosDuplicateSelection();
                    } else {
                        iframeWin.dispatchEvent(new CustomEvent('eidos-duplicate-slide'));
                    }
                }
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (iframeWin.eidosDeleteSelection && iframeWin.eidosGetSelection && iframeWin.eidosGetSelection()) {
                iframeWin.eidosDeleteSelection();
                e.preventDefault();
            }
        } else if (e.key.startsWith('Arrow')) {
            if (iframeWin.eidosArrowMove && iframeWin.eidosGetSelection && iframeWin.eidosGetSelection()) {
                iframeWin.eidosArrowMove(e.key, e.shiftKey);
                e.preventDefault();
            }
        }
    };

    if (window._eidosKeydownHandler) {
        window.removeEventListener('keydown', window._eidosKeydownHandler);
    }
    window._eidosKeydownHandler = keydownHandler;
    window.addEventListener('keydown', window._eidosKeydownHandler);

    // Support for dropping images at specific coordinates
};
