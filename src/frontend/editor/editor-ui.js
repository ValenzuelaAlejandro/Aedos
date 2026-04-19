// Aedos Editor UI (Left Panel & Right Panel logic)

window.initEditorUI = function (iframe) {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const iframeWin = iframe.contentWindow;

    if (!iframeDoc || !iframeDoc.body) return;
    
    function safeAddListener(id, event, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }

    // Subscriptions for keyboard navigation and duplication
    iframeWin.addEventListener('navigate-prev', () => {
        if (window.prevSlide) window.prevSlide();
    });
    iframeWin.addEventListener('navigate-next', () => {
        if (window.nextSlide) window.nextSlide();
    });
    iframeWin.addEventListener('duplicate-slide', () => {
        const slidesCount = iframeDoc.querySelectorAll('section[class*="s"]').length;
        if (slidesCount >= 15) return;
        if (iframeWin.editorSaveState) iframeWin.editorSaveState();
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
        if (iframeWin.editorUndo) iframeWin.editorUndo();
    });
    safeAddListener('btn-redo', 'click', () => {
        if (iframeWin.editorRedo) iframeWin.editorRedo();
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
    if (window._minimapInterval) clearInterval(window._minimapInterval);
    window._minimapInterval = setInterval(() => {
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
                    if (iframeWin.editorRedo) iframeWin.editorRedo();
                } else {
                    if (iframeWin.editorUndo) iframeWin.editorUndo();
                }
                e.preventDefault();
            } else if (key === 'y') {
                if (iframeWin.editorRedo) iframeWin.editorRedo();
                e.preventDefault();
            } else if (key === 'd') {
                if (!e.target.isContentEditable) {
                    e.preventDefault();
                    if (iframeWin.editorDuplicateSelection && iframeWin.editorGetSelection && iframeWin.editorGetSelection()) {
                        iframeWin.editorDuplicateSelection();
                    } else {
                        iframeWin.dispatchEvent(new CustomEvent('duplicate-slide'));
                    }
                }
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (iframeWin.editorDeleteSelection && iframeWin.editorGetSelection && iframeWin.editorGetSelection()) {
                iframeWin.editorDeleteSelection();
                e.preventDefault();
            }
        } else if (e.key.startsWith('Arrow')) {
            if (iframeWin.editorArrowMove && iframeWin.editorGetSelection && iframeWin.editorGetSelection()) {
                iframeWin.editorArrowMove(e.key, e.shiftKey);
                e.preventDefault();
            }
        }
    };

    if (window._keydownHandler) {
        window.removeEventListener('keydown', window._keydownHandler);
    }
    window._keydownHandler = keydownHandler;
    window.addEventListener('keydown', window._keydownHandler);

    // Support for dropping images at specific coordinates
};
