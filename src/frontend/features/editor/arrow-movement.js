/** @typedef {{getSelectedElement: () => (HTMLElement&{_undoSavingArrow?: boolean})|null, document: Document, setTimeout: typeof setTimeout, saveState: () => void, resolveDragCollision: Function, updateSelectionBox: () => void}} EditorArrowMovementOptions */

/** Creates the legacy selected-element arrow movement operation. @param {EditorArrowMovementOptions} options @returns {(key: string, shift: boolean) => void} */
export function createEditorArrowMover({
    getSelectedElement,
    document,
    setTimeout,
    saveState,
    resolveDragCollision,
    updateSelectionBox,
}) {
    return function moveSelectedElementByArrow(key, shift) {
        const selectedElement = getSelectedElement();
        if (!selectedElement) return;
        if (!selectedElement._undoSavingArrow) {
            saveState();
            selectedElement._undoSavingArrow = true;
            setTimeout(() => {
                const currentSelection = getSelectedElement();
                if (currentSelection) currentSelection._undoSavingArrow = false;
            }, 500);
        }
        const amount = shift ? 10 : 1;
        let newLeft = parseFloat(selectedElement.style.left) || 0;
        let newTop = parseFloat(selectedElement.style.top) || 0;

        if (key === 'ArrowUp') newTop -= amount;
        if (key === 'ArrowDown') newTop += amount;
        if (key === 'ArrowLeft') newLeft -= amount;
        if (key === 'ArrowRight') newLeft += amount;

        const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
        const rect = selectedElement.getBoundingClientRect();
        const resolved = resolveDragCollision({
            left: newLeft,
            top: newTop,
            width: rect.width,
            height: rect.height,
        }, slide, selectedElement);

        selectedElement.style.left = `${resolved.left}px`;
        selectedElement.style.top = `${resolved.top}px`;
        updateSelectionBox();
    };
}
