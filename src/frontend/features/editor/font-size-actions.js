/** @typedef {{document: Document, window: Window, getSelectedElement: () => Element|null, saveState: () => void}} EditorFontSizeActionsOptions */

/** Create the existing font-size commands over editor-owned selection state.
 * @param {EditorFontSizeActionsOptions} options
 */
export function createEditorFontSizeActions({ document, window, getSelectedElement, saveState }) {
    function changeFontSize(delta) {
        const selectedElement = getSelectedElement();
        if (!selectedElement) return;
        saveState();
        const style = window.getComputedStyle(selectedElement);
        const currentSize = parseFloat(style.fontSize) || 16;
        const newSize = Math.max(8, Math.min(200, currentSize + delta));
        selectedElement.style.fontSize = newSize + 'px';
        updateSizeDisplay();
    }

    function updateSizeDisplay() {
        const selectedElement = getSelectedElement();
        const valEl = document.getElementById('editor-tb-size-val');
        if (selectedElement && valEl) {
            const style = window.getComputedStyle(selectedElement);
            valEl.textContent = Math.round(parseFloat(style.fontSize)) || 16;
        }
    }

    return { changeFontSize, updateSizeDisplay };
}
