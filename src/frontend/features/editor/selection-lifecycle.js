/**
 * @typedef {object} AedosEditorSelectionLifecycleOptions
 * @property {Document} document
 * @property {Window} window
 * @property {typeof MutationObserver} MutationObserver
 * @property {typeof ResizeObserver} ResizeObserver
 * @property {typeof CustomEvent} CustomEvent
 * @property {(callback: () => void, delay: number) => number} setTimeout
 * @property {() => Element|null} getSelectedElement
 * @property {(element: Element|null) => void} setSelectedElement
 * @property {() => boolean} getIsLocked
 * @property {() => void} setJustSelected
 * @property {() => void} freezeSlideLayout
 * @property {() => void} ensureUI
 * @property {() => string} getToolbarHTML
 * @property {() => void} bindToolbarEvents
 * @property {() => void} updateSelectionBox
 * @property {() => void} updateSizeDisplay
 * @property {Element} selectionBox
 * @property {HTMLElement} toolbar
 */

/** @typedef {{selectElement: (element: Element|null) => void, deselectGroup: (silent?: boolean) => void}} AedosEditorSelectionLifecycleApi */

/** Creates selection observers and selection/deselection lifecycle operations. @param {AedosEditorSelectionLifecycleOptions} options @returns {AedosEditorSelectionLifecycleApi} */
export function createEditorSelectionLifecycle({
    document,
    window,
    MutationObserver,
    ResizeObserver,
    CustomEvent,
    setTimeout,
    getSelectedElement,
    setSelectedElement,
    getIsLocked,
    setJustSelected,
    freezeSlideLayout,
    ensureUI,
    getToolbarHTML,
    bindToolbarEvents,
    updateSelectionBox,
    updateSizeDisplay,
    selectionBox,
    toolbar,
}) {
    let selectionObserver = null;

    function selectElement(element) {
        if (!element || getSelectedElement() === element) return;
        if (getIsLocked()) return;

        const slide = element.closest('.s') || element.closest('section') || document.body;
        freezeSlideLayout(slide);

        if (selectionObserver) selectionObserver.disconnect();
        window.focus();
        setSelectedElement(element);
        ensureUI();

        toolbar.innerHTML = getToolbarHTML();
        bindToolbarEvents();

        selectionBox.style.zIndex = '10000';
        toolbar.style.zIndex = '10001';

        updateSelectionBox();
        updateSizeDisplay();
        const colorPicker = document.getElementById('editor-color-picker');
        if (colorPicker) colorPicker.style.display = 'none';

        selectionObserver = new MutationObserver(() => {
            updateSelectionBox();
            const elStyle = window.getComputedStyle(element);
            const elZ = parseInt(elStyle.zIndex) || 1;
            selectionBox.style.zIndex = Math.max(1000, elZ + 1);
            toolbar.style.zIndex = Math.max(1001, elZ + 2);
        });
        selectionObserver.observe(element, {
            attributes: true,
            attributeFilter: ['style', 'class'],
            characterData: true,
            subtree: true,
        });

        if (window.ResizeObserver) {
            const resizeObs = new ResizeObserver(() => {
                // Grow-upwards only for standalone absolute elements normalized directly under a slide.
                if (element.isContentEditable && element._baseBottom !== undefined && element.style.position === 'absolute') {
                    const rect = element.getBoundingClientRect();
                    const slide = element.closest('.s') || document.body;
                    const currentHeight = rect.height;
                    const newTop = Math.max(0, element._baseBottom - currentHeight);
                    element.style.top = newTop + "px";
                }
                updateSelectionBox();
            });
            resizeObs.observe(element);
            selectionObserver._resizeObs = resizeObs;
        }

        window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element } }));
        setJustSelected(true);
        setTimeout(() => { setJustSelected(false); }, 250);
    }

    function deselectGroup(silent = false) {
        if (selectionObserver) {
            if (selectionObserver._parentObs) selectionObserver._parentObs.disconnect();
            if (selectionObserver._resizeObs) selectionObserver._resizeObs.disconnect();
            selectionObserver.disconnect();
            selectionObserver = null;
        }

        setSelectedElement(null);
        selectionBox.style.display = 'none';
        toolbar.style.display = 'none';

        const colorPicker = document.getElementById('editor-color-picker');
        if (colorPicker) colorPicker.style.display = 'none';
        if (!silent) {
            window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element: null } }));
        }
    }

    return { selectElement, deselectGroup };
}
