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
import { createEditorKeyboardHandler } from '../features/editor/keyboard.js';
import { bindEditorContentEvents } from '../features/editor/content-bindings.js';
import { installEditorCompatibilityFacade } from '../features/editor/compatibility-facade.js';
import { createEditorSnapTargets } from '../features/editor/snap-targets.js';
import { createEditorColorPicker } from '../features/editor/color-picker.js';
import { renderEditorToolbarMarkup } from '../features/editor/toolbar-markup.js';
import { bindEditorToolbarSizeEvents } from '../features/editor/toolbar-size-events.js';
import { bindEditorToolbarActionEvents } from '../features/editor/toolbar-action-events.js';
import { bindEditorToolbarSwatchEvents } from '../features/editor/toolbar-swatch-events.js';
import { registerEditorMouseupCleanup } from '../features/editor/mouseup-cleanup.js';
import { createEditorFontSizeActions } from '../features/editor/font-size-actions.js';
import { createEditorElementOperations } from '../features/editor/element-operations.js';
import { createEditorGrouping } from '../features/editor/grouping.js';
import { createEditorSelectionDom } from '../features/editor/selection-dom.js';
import { installEditorSlideObservers } from '../features/editor/slide-observers.js';
import { createEditorArrowMover } from '../features/editor/arrow-movement.js';
import { createEditorPointerState } from '../features/editor/pointer-state.js';
import { bindEditorBodyPointerDown } from '../features/editor/body-pointer-events.js';
import { bindEditorPointerInteractions } from '../features/editor/pointer-interactions.js';

function initEditor() {
    if (window._editorInitialized) return;
    window._editorInitialized = true;

    const pointerState = createEditorPointerState();
    window.setLocked = (locked) => {
        pointerState.isLocked = locked;
        if (locked) {
            document.body.classList.add('editor-locked');
            deselectGroup();
            pointerState.isDragging = false;
            pointerState.isResizing = false;
        } else {
            document.body.classList.remove('editor-locked');
        }
    };

    // Auto-lock if parent goes fullscreen
    const syncLockWithFullscreen = () => {
        const isFS = !!(document.fullscreenElement || window.parent.document.fullscreenElement || document.webkitFullscreenElement || window.parent.document.webkitFullscreenElement);
        window.setLocked(isFS);
    };
    document.addEventListener('fullscreenchange', syncLockWithFullscreen);
    window.parent.document.addEventListener('fullscreenchange', syncLockWithFullscreen);
    document.addEventListener('webkitfullscreenchange', syncLockWithFullscreen);
    window.parent.document.addEventListener('webkitfullscreenchange', syncLockWithFullscreen);

    // Track which slides have been "frozen" into absolute layout to avoid reflows
    const _isFrozenMap = new WeakMap();

    // Selection Observer to update box on property changes

    /**
     * Grouping Helper: Finds elements visually inside a container to treat them as a unit
     */
    function collectGroup(target) {
        return editorGrouping(target);
    }

    const { selectionBox, handleEls, toolbar, guideH, guideV, ensureUI } = createEditorSelectionDom({ document });
    ensureUI();

    installEditorSlideObservers({
        document,
        window,
        MutationObserver,
        getSelectedElement: () => pointerState.selectedElement,
        deselect: () => deselectGroup(),
    });


    // Toolbar content
    function getToolbarHTML() {
        return renderEditorToolbarMarkup({
            window,
            selectedElement: pointerState.selectedElement,
            palette: getDynamicPalette(),
            isImageSlotElement,
            isTextEditableElement,
        });
    }

    let activeColorAction = null; // 'text' or 'bg'
    const { changeFontSize, updateSizeDisplay } = createEditorFontSizeActions({
        document,
        window,
        getSelectedElement: () => pointerState.selectedElement,
        saveState: () => saveState(),
    });

    function deleteElement(el) {
        return elementOperations.deleteElement(el);
    }

    function bindToolbarEvents() {
        bindEditorToolbarSizeEvents({ document, changeFontSize });
        bindEditorToolbarActionEvents({
            document,
            window,
            getSelectedElement: () => pointerState.selectedElement,
            showColorPicker: (action, anchor) => {
                activeColorAction = action;
                showColorPicker(anchor);
            },
            replaceImage: element => window.parent._triggerImagePicker(element),
            deleteSelected: () => deleteElement(pointerState.selectedElement),
            duplicateSelected: () => duplicateElement(pointerState.selectedElement),
        });

        bindEditorToolbarSwatchEvents({
            toolbar,
            getSelectedElement: () => pointerState.selectedElement,
            saveState: () => saveState(),
            isTextEditableElement: element => isTextEditableElement(element),
            dispatchSelectionChanged: element => window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element } })),
        });
    }

    bindToolbarEvents();

    const { getDynamicPalette, showColorPicker } = createEditorColorPicker({
        document,
        window,
        getSelectedElement: () => pointerState.selectedElement,
        getActiveColorAction: () => activeColorAction,
        saveState: () => saveState(),
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

    // Initial Save!
    setTimeout(saveState, 500);


    function duplicateElement(el) {
        return elementOperations.duplicateElement(el);
    }

    const moveSelectedElementByArrow = createEditorArrowMover({
        getSelectedElement: () => pointerState.selectedElement,
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
        getSelectedElement: () => pointerState.selectedElement,
        getIsLocked: () => pointerState.isLocked,
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

    // Save initial state
    saveState();

    installEditorCompatibilityFacade({
        window,
        getSelectedElement: () => pointerState.selectedElement,
        getIsJustSelected: () => pointerState.justSelected,
        getIsDragging: () => pointerState.isDragging,
        getIsResizing: () => pointerState.isResizing,
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditor);
} else {
    initEditor();
}
