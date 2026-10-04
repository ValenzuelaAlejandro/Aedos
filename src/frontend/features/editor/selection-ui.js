/** @typedef {{left: number, top: number, width: number, height: number, toolbarLeft: number, toolbarTop: number, isVisible: boolean, isSmall: boolean}} EditorSelectionUiGeometry */

/**
 * @typedef {object} AedosEditorSelectionUiOptions
 * @property {() => Element|null} getSelectedElement
 * @property {Element} selectionBox
 * @property {HTMLElement} toolbar
 * @property {Window} window
 * @property {() => boolean} getIsDragging
 * @property {() => boolean} getIsResizing
 * @property {(rect: DOMRect, viewport: {width: number, height: number}, toolbarWidth: number) => EditorSelectionUiGeometry} calculateGeometry
 */

/** Creates the existing selection rectangle and toolbar positioning update. @param {AedosEditorSelectionUiOptions} options @returns {() => void} */
export function createEditorSelectionUi({
    getSelectedElement,
    selectionBox,
    toolbar,
    window,
    getIsDragging,
    getIsResizing,
    calculateGeometry,
}) {
    return function updateSelectionBox() {
        const selectedElement = getSelectedElement();
        if (!selectedElement) return;
        const rect = selectedElement.getBoundingClientRect();
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        const geometry = calculateGeometry(
            rect,
            { width: winW, height: winH },
            toolbar.offsetWidth,
        );

        // If the element is entirely outside the viewport, hide the UI and bail.
        if (!geometry.isVisible) {
            selectionBox.style.display = 'none';
            toolbar.style.display = 'none';
            return;
        }

        selectionBox.style.left = `${geometry.left}px`;
        selectionBox.style.top = `${geometry.top}px`;
        selectionBox.style.width = `${geometry.width}px`;
        selectionBox.style.height = `${geometry.height}px`;

        if (geometry.isSmall) {
            selectionBox.classList.add('editor-small-selection');
        } else {
            selectionBox.classList.remove('editor-small-selection');
        }

        if (!getIsDragging() && !getIsResizing()) {
            toolbar.style.display = 'flex';
            selectionBox.style.display = 'block';
        } else {
            toolbar.style.display = 'none';
        }

        // SMART POSITIONING: Keep toolbar within window boundaries
        toolbar.style.left = `${geometry.toolbarLeft}px`;
        toolbar.style.top = `${geometry.toolbarTop}px`;

        if (!getIsDragging() && !getIsResizing()) {
            toolbar.style.opacity = '1';
            toolbar.style.transform = 'translateY(0)';
        }
    };
}
