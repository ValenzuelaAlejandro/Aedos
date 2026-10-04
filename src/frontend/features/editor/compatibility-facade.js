/**
 * @typedef {object} AedosEditorCompatibilityFacadeOptions
 * @property {Window} window
 * @property {() => Element|null} getSelectedElement
 * @property {() => boolean} getIsJustSelected
 * @property {() => boolean} getIsDragging
 * @property {() => boolean} getIsResizing
 * @property {() => void} undo
 * @property {() => void} redo
 * @property {() => void} saveState
 * @property {(silent?: boolean) => void} deselect
 * @property {() => void} updateSelection
 * @property {(element: Element|null) => void} selectElement
 * @property {(element: Element) => void} duplicate
 * @property {(element: Element|null) => void} deleteElement
 * @property {(key: string, shift: boolean) => void} arrowMove
 */

/** Installs the existing parent-frame `window.*` editor API. @param {AedosEditorCompatibilityFacadeOptions} options */
export function installEditorCompatibilityFacade({
    window,
    getSelectedElement,
    getIsJustSelected,
    getIsDragging,
    getIsResizing,
    undo,
    redo,
    saveState,
    deselect,
    updateSelection,
    selectElement,
    duplicate,
    deleteElement,
    arrowMove,
}) {
    window.editorUndo = undo;
    window.editorRedo = redo;
    window.editorSaveState = saveState;
    window.editorDeselect = deselect;
    window.editorUpdateSelection = updateSelection;
    window.editorGetSelection = () => getSelectedElement();
    window.editorSelect = selectElement;
    window.isJustSelected = () => getIsJustSelected();
    window.editorIsDragging = () => getIsDragging() || getIsResizing();
    window.editorDuplicateSelection = () => {
        const selectedElement = getSelectedElement();
        if (selectedElement) duplicate(selectedElement);
    };
    window.editorDeleteSelection = () => deleteElement(getSelectedElement());

    window.toFront = () => {
        const selectedElement = getSelectedElement();
        if (!selectedElement) return;
        saveState();
        const parent = selectedElement.parentElement;
        const currentStyle = window.getComputedStyle(selectedElement);
        if (currentStyle.position === 'static') selectedElement.style.position = 'relative';

        const siblings = Array.from(parent.children).filter(sibling => sibling !== selectedElement);
        let maxZ = 0;
        siblings.forEach(sibling => {
            const style = window.getComputedStyle(sibling);
            let z = parseInt(style.zIndex);
            if (isNaN(z) && style.position !== 'static') z = 1;
            if (!isNaN(z) && z > maxZ) maxZ = z;
        });

        selectedElement.style.zIndex = maxZ + 1;
        parent.appendChild(selectedElement);
        updateSelection();
    };

    window.toBack = () => {
        const selectedElement = getSelectedElement();
        if (!selectedElement) return;
        saveState();
        const parent = selectedElement.parentElement;
        const currentStyle = window.getComputedStyle(selectedElement);
        if (currentStyle.position === 'static') selectedElement.style.position = 'relative';

        const siblings = Array.from(parent.children).filter(sibling => sibling !== selectedElement);
        let minZ = 1000;
        let foundAny = false;
        siblings.forEach(sibling => {
            const style = window.getComputedStyle(sibling);
            let z = parseInt(style.zIndex);
            if (isNaN(z) && style.position !== 'static') z = 1;
            if (!isNaN(z)) {
                if (z < minZ) minZ = z;
                foundAny = true;
            }
        });

        if (!foundAny) minZ = 1;
        const newZ = Math.max(0, minZ - 1);
        selectedElement.style.zIndex = newZ;
        parent.prepend(selectedElement);
        updateSelection();
    };

    window.editorArrowMove = (key, shift) => arrowMove(key, shift);
}
