/** @typedef {{document: Document, setIsDragging: (value: boolean) => void, setIsResizing: (value: boolean) => void, setCurrentHandle: (value: string|null) => void, setDragGroup: (value: unknown[]) => void, setActiveDragTarget: (value: Element|null) => void, guideH: HTMLElement, guideV: HTMLElement, getSelectedElement: () => (Element&{_normalized?: boolean})|null, updateSelectionBox: () => void, getAllEditables: () => Element[]}} EditorPointerCleanupOptions */

/** Installs the existing mouseup cleanup and state-reset listener. @param {EditorPointerCleanupOptions} options */
export function installEditorPointerCleanup({
    document,
    setIsDragging,
    setIsResizing,
    setCurrentHandle,
    setDragGroup,
    setActiveDragTarget,
    guideH,
    guideV,
    getSelectedElement,
    updateSelectionBox,
    getAllEditables,
}) {
    document.addEventListener('mouseup', () => {
        setIsDragging(false);
        setIsResizing(false);
        setCurrentHandle(null);
        setDragGroup([]);
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
