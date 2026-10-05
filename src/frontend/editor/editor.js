/**
 * Aedos Visual Editor
 * Injected into the presentation iframe to allow Canva-like editing.
 */
import { createAedosEditorSemantics } from '../features/editor/semantics.js';
import { createEditorHistory } from '../features/editor/history.js';
import { calculateEditorSelectionGeometry } from '../features/editor/selection-geometry.js';
import { resolveDragCollision, resolveResizeCollision } from '../features/editor/collision-geometry.js';
import { createEditorTargeting } from '../features/editor/targeting.js';
import { createEditorStyleSnapshot } from '../features/editor/style-snapshot.js';
import { createEditorSelectionUi } from '../features/editor/selection-ui.js';
import { createEditorSlideFreeze, createEditorElementNormalizer, createEditorFreezeAllSlides } from '../features/editor/slide-freeze.js';
import { createEditorSelectionLifecycle } from '../features/editor/selection-lifecycle.js';
import { bindEditorContentEvents } from '../features/editor/content-bindings.js';
import { createEditorSnapTargets } from '../features/editor/snap-targets.js';
import { registerEditorMouseupCleanup } from '../features/editor/mouseup-cleanup.js';
import { createEditorElementOperations } from '../features/editor/element-operations.js';
import { createEditorGrouping } from '../features/editor/grouping.js';
import { createEditorSelectionToolbarRuntime } from '../features/editor/selection-toolbar-runtime.js';
import { installEditorRuntimeBindings } from '../features/editor/runtime-bindings.js';
import { createEditorPointerState } from '../features/editor/pointer-state.js';
import { bindEditorBodyPointerDown } from '../features/editor/body-pointer-events.js';
import { bindEditorPointerInteractions } from '../features/editor/pointer-interactions.js';
import { bindEditorLockLifecycle } from '../features/editor/lock-lifecycle.js';

function initEditor() {
    if (window._editorInitialized) return;
    window._editorInitialized = true;

    const pointerState = createEditorPointerState();
    bindEditorLockLifecycle({
        document,
        window,
        pointerState,
        deselectGroup: () => deselectGroup(),
    });

    // Track which slides have been "frozen" into absolute layout to avoid reflows
    const _isFrozenMap = new WeakMap();

    // Selection Observer to update box on property changes

    /**
     * Grouping Helper: Finds elements visually inside a container to treat them as a unit
     */
    function collectGroup(target) {
        return editorGrouping(target);
    }

    function deleteElement(el) {
        return elementOperations.deleteElement(el);
    }

    const {
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
    } = createEditorSelectionToolbarRuntime({
        document,
        window,
        MutationObserver,
        pointerState,
        saveState: () => saveState(),
        isImageSlotElement: element => isImageSlotElement(element),
        isTextEditableElement: element => isTextEditableElement(element),
        replaceImage: element => window.parent._triggerImagePicker(element),
        deleteSelected: () => deleteElement(pointerState.selectedElement),
        duplicateSelected: () => duplicateElement(pointerState.selectedElement),
        deselectGroup: () => deselectGroup(),
        CustomEvent,
    });


    // Editable Elements Target Mapping
    const editorSemantics = createAedosEditorSemantics();
    const {
        editableSelectors,
        textEditableSelectors: TEXT_EDITABLE_SELECTORS,
        ignoreSelectors,
        getSlideRoot,
        isIgnoredElement,
        isTextEditableElement,
        isHeadingLikeElement,
        isTextContainerElement,
        isImageSlotElement,
        isVisualLeafElement,
        isSemanticContainer,
        getNearestSemanticContainerAncestor,
        isEditableElement,
    } = editorSemantics;
    window.editableSelectors = editableSelectors; // Export for UI

    const {
        getEditableElementsInNode,
        getEditableElementsInSlide,
        getTopLevelEditableElements,
        getAllEditableElements,
        findEditableTarget,
        getStableDragTarget,
    } = createEditorTargeting({ document, Element, Node, semantics: editorSemantics });

    const freezeSlideLayout = createEditorSlideFreeze({
        frozenSlides: _isFrozenMap,
        saveState: () => saveState(),
        getEditableElementsInSlide: (slide, excludeEl) => getEditableElementsInSlide(slide, excludeEl),
        getTopLevelEditableElements: (root, excludeEl, includeRoot) =>
            getTopLevelEditableElements(root, excludeEl, includeRoot),
        normalizeElement: (element, slide, silent, rect) => normalizeElement(element, slide, silent, rect),
    });

    // Exposed for parent frame: freeze all slides before PDF export without
    // polluting the undo history. Slides already frozen are skipped.
    window.freezeAllSlides = createEditorFreezeAllSlides({
        document,
        frozenSlides: _isFrozenMap,
        getEditableElementsInSlide,
        getTopLevelEditableElements,
        normalizeElement: (element, slide, silent, rect) => normalizeElement(element, slide, silent, rect),
    });

    const getInheritedStyles = createEditorStyleSnapshot(window.getComputedStyle.bind(window));

    const normalizeElement = createEditorElementNormalizer({
        window,
        setTimeout,
        saveState: () => saveState(),
        getNearestSemanticContainerAncestor,
        isTextEditableElement,
        isTextContainerElement,
        isHeadingLikeElement,
        textEditableSelectors: editorSemantics.textEditableSelectors,
        getInheritedStyles,
    });

    const editorGrouping = createEditorGrouping({ document, isSemanticContainer, getEditableElementsInSlide });



    bindEditorBodyPointerDown({
        document,
        pointerState,
        ensureUI,
        findEditableTarget,
        isImageSlotElement,
        isTextEditableElement,
        selectElement: element => selectElement(element),
        deselectGroup: () => deselectGroup(),
        getStableDragTarget,
        createSnapTargets: createEditorSnapTargets,
        getEditableElementsInSlide,
    });

    registerEditorMouseupCleanup({
        document,
        setDragging: value => { pointerState.isDragging = value; },
        setResizing: value => { pointerState.isResizing = value; },
        setCurrentHandle: value => { pointerState.currentHandle = value; },
        clearDragGroup: () => { pointerState.dragGroup = []; },
        setActiveDragTarget: value => { pointerState.activeDragTarget = value; },
        guideH,
        guideV,
        getSelectedElement: () => pointerState.selectedElement,
        updateSelectionBox: () => updateSelectionBox(),
        getAllEditables: () => getAllEditableElements(),
    });

    bindEditorContentEvents({
        document,
        window,
        selectionBox,
        toolbar,
        getIsLocked: () => pointerState.isLocked,
        getSelectedElement: () => pointerState.selectedElement,
        isTextEditableElement,
        normalizeElement,
        saveState: () => saveState(),
        selectElement: element => selectElement(element),
        textEditableSelectors: TEXT_EDITABLE_SELECTORS,
        CustomEvent,
    });

    bindEditorPointerInteractions({
        document,
        selectionBox,
        pointerState,
        saveState: () => saveState(),
        getStableDragTarget,
        normalizeElement,
        selectElement: element => selectElement(element),
        updateSelectionBox: () => updateSelectionBox(),
        guideH,
        guideV,
    });

    const updateSelectionBox = createEditorSelectionUi({
        getSelectedElement: () => pointerState.selectedElement,
        selectionBox,
        toolbar,
        window,
        getIsDragging: () => pointerState.isDragging,
        getIsResizing: () => pointerState.isResizing,
        calculateGeometry: calculateEditorSelectionGeometry,
    });

    const { selectElement, deselectGroup } = createEditorSelectionLifecycle({
        document,
        window,
        MutationObserver,
        ResizeObserver,
        CustomEvent,
        setTimeout,
        getSelectedElement: () => pointerState.selectedElement,
        setSelectedElement: element => { pointerState.selectedElement = element; },
        getIsLocked: () => pointerState.isLocked,
        setJustSelected: value => { pointerState.justSelected = value; },
        freezeSlideLayout,
        ensureUI,
        getToolbarHTML,
        bindToolbarEvents,
        updateSelectionBox,
        updateSizeDisplay,
        selectionBox,
        toolbar,
    });

    // --- UNDO / REDO LOGIC ---
    const editorHistory = createEditorHistory({
        getIsRestoring: () => pointerState.isRestoring,
        setIsRestoring: value => { pointerState.isRestoring = value; },
        deselectGroup,
        ensureUI
    });
    const { saveState, undo, redo } = editorHistory;
    const elementOperations = createEditorElementOperations({
        document,
        saveState,
        freezeSlideLayout,
        collectGroup,
        deselectGroup,
        normalizeElement,
        selectElement,
    });

    installEditorRuntimeBindings({
        document,
        window,
        CustomEvent,
        setTimeout,
        saveState,
        elementOperations,
        getSelectedElement: () => pointerState.selectedElement,
        getIsLocked: () => pointerState.isLocked,
        getIsJustSelected: () => pointerState.justSelected,
        getIsDragging: () => pointerState.isDragging,
        getIsResizing: () => pointerState.isResizing,
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
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditor);
} else {
    initEditor();
}
