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
 * @property {(element: Element|null) => void} select
 * @property {(element: Element) => void} duplicate
 * @property {(element: Element|null) => void} deleteElement
 * @property {(key: string, shift: boolean) => void} arrowMove
 * @property {(rect: {left: number, top: number, width: number, height: number}, slide: Element, exclude: Element) => {left: number, top: number}} resolveDragCollision
 */

/** Installs the existing parent-frame `window.*` compatibility API. @param {AedosEditorCompatibilityFacadeOptions} options */
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
    select,
    duplicate,
    deleteElement,
    arrowMove,
    resolveDragCollision,
}) {
    window.editorUndo = undo;
    window.editorRedo = redo;
    window.editorSaveState = saveState;
    window.editorDeselect = deselect;
    window.editorUpdateSelection = updateSelection;
    window.editorGetSelection = () => getSelectedElement();
    window.editorSelect = select;
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

        // Ensure the element has a positioning context so z-index works
        const currentStyle = window.getComputedStyle(selectedElement);
        if (currentStyle.position === 'static') {
            selectedElement.style.position = 'relative';
        }

        // Strategy: Max z-index among siblings (excluding self) + 1
        const siblings = Array.from(parent.children).filter(s => s !== selectedElement);
        let maxZ = 0;
        siblings.forEach(s => {
            const style = window.getComputedStyle(s);
            let z = parseInt(style.zIndex);
            // If it's positioned but has no z-index, it's effectively 1 for layering
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

        // Ensure the element has a positioning context so z-index works
        const currentStyle = window.getComputedStyle(selectedElement);
        if (currentStyle.position === 'static') {
            selectedElement.style.position = 'relative';
        }

        // Strategy: Min z-index among siblings (excluding self) - 1
        const siblings = Array.from(parent.children).filter(s => s !== selectedElement);
        let minZ = 1000;
        let foundAny = false;
        siblings.forEach(s => {
            const style = window.getComputedStyle(s);
            let z = parseInt(style.zIndex);
            if (isNaN(z) && style.position !== 'static') z = 1;
            if (!isNaN(z)) {
                if (z < minZ) minZ = z;
                foundAny = true;
            }
        });

        // If no siblings have z-index, we assume they are at layer 1
        if (!foundAny) minZ = 1;

        // Allow going down to 0. 0 is used by background slots in some templates.
        // We avoid negative z-index to prevent disappearing behind the slide container itself.
        const newZ = Math.max(0, minZ - 1);
        selectedElement.style.zIndex = newZ;
        parent.prepend(selectedElement);
        updateSelection();
    };

    window.editorArrowMove = (key, shift) => arrowMove(key, shift);
}
