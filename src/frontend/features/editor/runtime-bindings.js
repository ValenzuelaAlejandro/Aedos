import { createEditorKeyboardHandler } from './keyboard.js';
import { installEditorCompatibilityFacade } from './compatibility-facade.js';
import { createEditorArrowMover } from './arrow-movement.js';

/**
 * @typedef {Object} EditorRuntimeBindingsDeps
 * @property {Document} document
 * @property {Window} window
 * @property {typeof setTimeout} setTimeout
 * @property {typeof CustomEvent} CustomEvent
 * @property {Function} saveState
 * @property {Object} elementOperations
 * @property {Function} getSelectedElement
 * @property {Function} getIsLocked
 * @property {Function} getIsJustSelected
 * @property {Function} getIsDragging
 * @property {Function} getIsResizing
 * @property {Function} undo
 * @property {Function} redo
 * @property {Function} deselectGroup
 * @property {Function} updateSelectionBox
 * @property {Function} collectGroup
 * @property {Function} getInheritedStyles
 * @property {Function} getStableDragTarget
 * @property {Function} normalizeElement
 * @property {Function} deleteElement
 * @property {Function} selectElement
 * @property {Function} resolveDragCollision
 */

/** Install the delayed initial save, keyboard handler and parent-frame facade in legacy order. */
export function installEditorRuntimeBindings(deps) {
    const {
        document,
        window,
        CustomEvent,
        setTimeout,
        saveState,
        elementOperations,
        getSelectedElement,
        getIsLocked,
        getIsJustSelected,
        getIsDragging,
        getIsResizing,
        undo,
        redo,
        deselectGroup,
        updateSelectionBox,
        collectGroup,
        getInheritedStyles,
        getStableDragTarget,
        normalizeElement,
        deleteElement,
        selectElement,
        resolveDragCollision,
    } = deps;

    setTimeout(saveState, 500);

    function duplicateElement(element) {
        return elementOperations.duplicateElement(element);
    }

    const moveSelectedElementByArrow = createEditorArrowMover({
        getSelectedElement,
        document,
        setTimeout,
        saveState,
        resolveDragCollision,
        updateSelectionBox,
    });

    document.addEventListener('keydown', createEditorKeyboardHandler({
        document,
        window,
        CustomEvent,
        setTimeout,
        getSelectedElement,
        getIsLocked,
        undo,
        redo,
        saveState,
        collectGroup,
        getInheritedStyles,
        getStableDragTarget,
        normalizeElement,
        deleteElement,
        selectElement,
        duplicateElement,
        moveSelectedElementByArrow,
    }));

    saveState();

    installEditorCompatibilityFacade({
        window,
        getSelectedElement,
        getIsJustSelected,
        getIsDragging,
        getIsResizing,
        undo,
        redo,
        saveState,
        deselect: deselectGroup,
        updateSelection: updateSelectionBox,
        selectElement,
        duplicate: duplicateElement,
        deleteElement,
        arrowMove: moveSelectedElementByArrow,
    });
}
