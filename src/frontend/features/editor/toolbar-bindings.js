import { bindEditorToolbarSizeEvents } from './toolbar-size-events.js';
import { bindEditorToolbarActionEvents } from './toolbar-action-events.js';
import { bindEditorToolbarSwatchEvents } from './toolbar-swatch-events.js';

/**
 * @typedef {Object} EditorToolbarBindingDependencies
 * @property {Document} document
 * @property {Window} window
 * @property {HTMLElement} toolbar
 * @property {Function} changeFontSize
 * @property {Function} getSelectedElement
 * @property {Function} setActiveColorAction
 * @property {Function} showColorPicker
 * @property {Function} replaceImage
 * @property {Function} deleteSelected
 * @property {Function} duplicateSelected
 * @property {Function} saveState
 * @property {Function} isTextEditableElement
 * @property {Function} dispatchSelectionChanged
 */

/** Bind toolbar groups in their previous size, action, then swatch order. */
export function bindEditorToolbarEvents(deps) {
    const {
        document,
        window,
        toolbar,
        changeFontSize,
        getSelectedElement,
        setActiveColorAction,
        showColorPicker,
        replaceImage,
        deleteSelected,
        duplicateSelected,
        saveState,
        isTextEditableElement,
        dispatchSelectionChanged,
    } = deps;

    bindEditorToolbarSizeEvents({ document, changeFontSize });
    bindEditorToolbarActionEvents({
        document,
        window,
        getSelectedElement,
        showColorPicker: (action, anchor) => {
            setActiveColorAction(action);
            showColorPicker(anchor);
        },
        replaceImage,
        deleteSelected,
        duplicateSelected,
    });

    bindEditorToolbarSwatchEvents({
        toolbar,
        getSelectedElement,
        saveState,
        isTextEditableElement,
        dispatchSelectionChanged,
    });
}
