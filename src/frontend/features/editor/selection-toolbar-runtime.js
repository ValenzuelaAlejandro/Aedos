import { createEditorSelectionDom } from './selection-dom.js';
import { installEditorSlideObservers } from './slide-observers.js';
import { renderEditorToolbarMarkup } from './toolbar-markup.js';
import { createEditorFontSizeActions } from './font-size-actions.js';
import { bindEditorToolbarEvents } from './toolbar-bindings.js';
import { createEditorColorPicker } from './color-picker.js';

/**
 * @typedef {Object} EditorSelectionToolbarRuntimeDeps
 * @property {Document} document
 * @property {Window} window
 * @property {MutationObserver} MutationObserver
 * @property {Object} pointerState
 * @property {Function} saveState
 * @property {Function} isImageSlotElement
 * @property {Function} isTextEditableElement
 * @property {Function} replaceImage
 * @property {Function} deleteSelected
 * @property {Function} duplicateSelected
 * @property {Function} deselectGroup
 * @property {typeof CustomEvent} CustomEvent
 */

/** Build selection chrome and bind toolbar behavior in the existing initialization order. */
export function createEditorSelectionToolbarRuntime(deps) {
    const {
        document,
        window,
        MutationObserver,
        pointerState,
        saveState,
        isImageSlotElement,
        isTextEditableElement,
        replaceImage,
        deleteSelected,
        duplicateSelected,
        deselectGroup,
        CustomEvent,
    } = deps;

    const { selectionBox, handleEls, toolbar, guideH, guideV, ensureUI } =
        createEditorSelectionDom({ document });
    ensureUI();

    installEditorSlideObservers({
        document,
        window,
        MutationObserver,
        getSelectedElement: () => pointerState.selectedElement,
        deselect: () => deselectGroup(),
    });

    let activeColorAction = null;
    let getDynamicPalette;
    let showColorPicker;

    function getToolbarHTML() {
        return renderEditorToolbarMarkup({
            window,
            selectedElement: pointerState.selectedElement,
            palette: getDynamicPalette(),
            isImageSlotElement,
            isTextEditableElement,
        });
    }

    const { changeFontSize, updateSizeDisplay } = createEditorFontSizeActions({
        document,
        window,
        getSelectedElement: () => pointerState.selectedElement,
        saveState,
    });

    function bindToolbarEvents() {
        bindEditorToolbarEvents({
            document,
            window,
            toolbar,
            changeFontSize,
            getSelectedElement: () => pointerState.selectedElement,
            setActiveColorAction: action => { activeColorAction = action; },
            showColorPicker: anchor => showColorPicker(anchor),
            replaceImage,
            deleteSelected,
            duplicateSelected,
            saveState,
            isTextEditableElement,
            dispatchSelectionChanged: element =>
                window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element } })),
        });
    }

    bindToolbarEvents();

    ({ getDynamicPalette, showColorPicker } = createEditorColorPicker({
        document,
        window,
        getSelectedElement: () => pointerState.selectedElement,
        getActiveColorAction: () => activeColorAction,
        saveState,
    }));

    return {
        selectionBox,
        handleEls,
        toolbar,
        guideH,
        guideV,
        ensureUI,
        getToolbarHTML,
        bindToolbarEvents,
        getDynamicPalette,
        showColorPicker,
        updateSizeDisplay,
    };
}
