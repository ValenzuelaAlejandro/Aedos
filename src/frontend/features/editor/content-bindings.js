import { createEditorPasteHandler, createEditorTextEditingHandler, createEditorDirectTextEditingHandler } from './content-editing.js';

/**
 * @typedef {Object} EditorContentBindingDependencies
 * @property {Document} document
 * @property {Window} window
 * @property {HTMLElement} selectionBox
 * @property {HTMLElement} toolbar
 * @property {Function} getIsLocked
 * @property {Function} getSelectedElement
 * @property {Function} isTextEditableElement
 * @property {Function} normalizeElement
 * @property {Function} saveState
 * @property {Function} selectElement
 * @property {string[]} textEditableSelectors
 * @property {Function} CustomEvent
 */

/** Register the editor's existing content-editing listeners in the same order. */
export function bindEditorContentEvents(deps) {
    const {
        document,
        window,
        selectionBox,
        toolbar,
        getIsLocked,
        getSelectedElement,
        isTextEditableElement,
        normalizeElement,
        saveState,
        selectElement,
        textEditableSelectors,
        CustomEvent,
    } = deps;

    // Prevent click events on the selection UI from bubbling to background deselection.
    selectionBox.addEventListener('click', (e) => e.stopPropagation());
    toolbar.addEventListener('click', (e) => e.stopPropagation());

    // Handle double-click to edit text.
    document.body.addEventListener('dblclick', createEditorDirectTextEditingHandler({
        document,
        window,
        selectionBox,
        getIsLocked,
        textEditableSelectors,
        normalizeElement,
        saveState,
    }));

    document.addEventListener('paste', createEditorPasteHandler({ document, window }));

    selectionBox.addEventListener('dblclick', createEditorTextEditingHandler({
        document,
        window,
        CustomEvent,
        selectionBox,
        getSelectedElement,
        getIsLocked,
        isTextEditableElement,
        normalizeElement,
        textEditableSelectors,
        saveState,
        selectElement,
    }));
}
