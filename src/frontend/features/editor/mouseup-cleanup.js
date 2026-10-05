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

/**
 * @typedef {{document: Document, pointerState: Object, guideH: HTMLElement, guideV: HTMLElement, getSelectedElement: () => Element|null, updateSelectionBox: () => void, getAllEditables: () => Element[]}} EditorPointerCleanupDependencies
 */

/** Adapt the editor's shared pointer state to the existing mouseup cleanup API. */
export function bindEditorPointerCleanup(deps) {
    const { document, pointerState, guideH, guideV, getSelectedElement, updateSelectionBox, getAllEditables } = deps;
    registerEditorMouseupCleanup({
        document,
        setDragging: value => { pointerState.isDragging = value; },
        setResizing: value => { pointerState.isResizing = value; },
        setCurrentHandle: value => { pointerState.currentHandle = value; },
        clearDragGroup: () => { pointerState.dragGroup = []; },
        setActiveDragTarget: value => { pointerState.activeDragTarget = value; },
        guideH,
        guideV,
        getSelectedElement,
        updateSelectionBox,
        getAllEditables,
    });
}
