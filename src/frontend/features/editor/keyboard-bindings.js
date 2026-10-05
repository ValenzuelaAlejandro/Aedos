import { createEditorKeyboardHandler } from './keyboard.js';

/**
 * @typedef {Object} EditorKeyboardBindingDependencies
 * @property {Document} document
 * @property {Window} window
 * @property {Function} CustomEvent
 * @property {Function} setTimeout
 * @property {Function} getSelectedElement
 * @property {Function} getIsLocked
 * @property {Function} undo
 * @property {Function} redo
 * @property {Function} saveState
 * @property {Function} collectGroup
 * @property {Function} getInheritedStyles
 * @property {Function} getStableDragTarget
 * @property {Function} normalizeElement
 * @property {Function} deleteElement
 * @property {Function} selectElement
 * @property {Function} duplicateElement
 * @property {Function} moveSelectedElementByArrow
 */

/** Register the editor keydown handler at the same bootstrap location. */
export function bindEditorKeyboardEvents(deps) {
    const { document, ...handlerDependencies } = deps;
    document.addEventListener('keydown', createEditorKeyboardHandler(handlerDependencies));
}
