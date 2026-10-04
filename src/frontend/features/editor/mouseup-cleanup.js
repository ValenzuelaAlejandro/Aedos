/** @typedef {{document: Document, setDragging: (value: boolean) => void, setResizing: (value: boolean) => void, setCurrentHandle: (value: null) => void, clearDragGroup: () => void, setActiveDragTarget: (value: null) => void, guideH: HTMLElement, guideV: HTMLElement, getSelectedElement: () => Element|null, updateSelectionBox: () => void, getAllEditables: () => Element[]}} EditorMouseupCleanupOptions */

/** Register the editor's existing mouseup cleanup in its original order.
 * @param {EditorMouseupCleanupOptions} options
 */
export function registerEditorMouseupCleanup({
    document,
    setDragging,
    setResizing,
    setCurrentHandle,
    clearDragGroup,
    setActiveDragTarget,
    guideH,
    guideV,
    getSelectedElement,
    updateSelectionBox,
    getAllEditables,
}) {
    document.addEventListener('mouseup', () => {
        setDragging(false);
        setResizing(false);
        setCurrentHandle(null);
        clearDragGroup();
        setActiveDragTarget(null);
        guideH.style.display = 'none';
        guideV.style.display = 'none';

        const selectedElement = getSelectedElement();
        if (selectedElement) {
            delete selectedElement._normalized;
            updateSelectionBox();
        }

        const allEditables = getAllEditables();
        allEditables.forEach(element => delete element._stateSavedSinceMousedown);
    });
}
