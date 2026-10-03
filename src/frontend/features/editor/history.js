/**
 * Undo/redo history for the presentation iframe editor.
 * The factory keeps history state private and receives only the lifecycle
 * hooks owned by the surrounding editor bootstrap.
 *
 * @typedef {object} EditorHistoryOptions
 * @property {() => boolean} getIsRestoring
 * @property {(value: boolean) => void} setIsRestoring
 * @property {(silent?: boolean) => void} deselectGroup
 * @property {() => void} ensureUI
 */

const getCurrentSlideIndex = () => {
    const slides = Array.from(document.querySelectorAll('section, .s, [class*="slide"]'));
    if (slides.length === 0) return 0;

    // 1. Check parent state first
    try {
        if (window.parent && window.parent.currentSlide !== undefined) {
            return window.parent.currentSlide;
        }
    } catch (e) {
        void e;
    }

    // 2. Check for .active class
    const activeIdx = slides.findIndex(s => s.classList.contains('active'));
    if (activeIdx !== -1) return activeIdx;

    // 3. Calculation based on container transform (most robust)
    const container = slides[0].parentElement;
    if (container) {
        const transform = window.getComputedStyle(container).transform;
        if (transform && transform !== 'none') {
            const matrix = new DOMMatrix(transform);
            const x = Math.abs(matrix.e); // The horizontal translation
            // Slide width is usually 1122px in this app
            const slideWidth = 1122;
            return Math.round(x / slideWidth);
        }
    }

    return 0;
};

/**
 * @param {EditorHistoryOptions} options
 * @returns {{saveState: () => void, undo: () => void, redo: () => void, restoreState: (entry: {html: string, slideIndex: number}) => void}}
 */
function createEditorHistory(options) {
    const { getIsRestoring, setIsRestoring, deselectGroup, ensureUI } = options;
    const history = [];
    let historyIndex = -1;

    function getCleanHTML() {
        // Optimization: Use cloneNode instead of innerHTML parsing for cloning.
        // Also avoid double-pass by serializing only once at the end.
        const bodyClone = document.body.cloneNode(true);

        // Remove system UI elements that shouldn't be in the state history
        // NOTE: We keep .img-replace-overlay (tooltips) in the history to prevent flicker.
        // Final exports (PPTX/PDF) clean them up separately anyway.
        const toRemove = bodyClone.querySelectorAll('.editor-selection-box, .editor-toolbar, .editor-guide, .editor-color-picker');
        toRemove.forEach(el => el.remove());

        return bodyClone.innerHTML;
    }

    function saveState() {
        if (getIsRestoring()) return;
        // Performance: Optimization to avoid getCleanHTML() on every save call.
        // We only serialize if we're not likely at the current state.
        const state = getCleanHTML();

        // Always try to get the current index from parent (most reliable)
        const slideIndex = (window.parent && window.parent.currentSlide !== undefined)
            ? window.parent.currentSlide
            : getCurrentSlideIndex();

        // Don't save if it's identical HTML to avoid duplicate history points
        if (historyIndex !== -1 && history[historyIndex].html === state) {
            return;
        }

        // Truncate history forward if we are in the middle of it
        history.splice(historyIndex + 1);
        history.push({ html: state, slideIndex: slideIndex });

        // Limit history size to 50
        if (history.length > 50) history.shift();
        historyIndex = history.length - 1;
    }

    function undo() {
        if (historyIndex > 0) {
            // Only save if index is at the tail
            if (historyIndex === history.length - 1) saveState();
            historyIndex--;
            restoreState(history[historyIndex]);
        }
    }

    function redo() {
        if (historyIndex < history.length - 1) {
            historyIndex++;
            restoreState(history[historyIndex]);
        }
    }

    function restoreState(entry) {
        if (!entry || !entry.html) return;

        // Fast-path: don't restore if already there
        if (document.body.innerHTML === entry.html) return;

        setIsRestoring(true);
        deselectGroup(true); // SILENT deselect during restoration

        document.body.innerHTML = entry.html;

        // Re-inject UI and bindings into documentElement (outside body transform context)
        ensureUI();

        // Re-init lucide icons ONLY if they are likely present as original i tags
        if (window.lucide && document.body.querySelector('i[data-lucide]')) {
            window.lucide.createIcons();
        }

        // Notify parent that state changed significantly (slides might have been added/removed)
        // Pass 'needsOverlayRebuild' so app.js can re-inject image slot overlays
        // Pass 'slideIndex' to restore scroll position
        window.dispatchEvent(new CustomEvent('state-restored', {
            detail: {
                needsOverlayRebuild: true
            }
        }));

        // Brief timeout to allow observers to settle before unlocking state saves
        setTimeout(() => { 
            setIsRestoring(false); 
            deselectGroup();
        }, 50);
    }

    return { saveState, undo, redo, restoreState };
}

window.AedosEditorHistory = Object.freeze({ create: createEditorHistory });
