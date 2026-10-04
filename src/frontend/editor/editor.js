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
import { createEditorSlideFreeze, createEditorElementNormalizer } from '../features/editor/slide-freeze.js';
import { createEditorSelectionLifecycle } from '../features/editor/selection-lifecycle.js';
import { createEditorKeyboardHandler } from '../features/editor/keyboard.js';
import { createEditorPasteHandler, createEditorTextEditingHandler, createEditorDirectTextEditingHandler } from '../features/editor/content-editing.js';
import { installEditorCompatibilityFacade } from '../features/editor/compatibility-facade.js';
import { createEditorSnapTargets } from '../features/editor/snap-targets.js';
import { applyEditorResize } from '../features/editor/resize-interaction.js';
import { applyEditorDrag } from '../features/editor/drag-interaction.js';
import { createEditorColorPicker } from '../features/editor/color-picker.js';
import { renderEditorToolbarMarkup } from '../features/editor/toolbar-markup.js';
import { createEditorElementOperations } from '../features/editor/element-operations.js';
import { createEditorGrouping } from '../features/editor/grouping.js';
import { createEditorSelectionDom } from '../features/editor/selection-dom.js';
import { installEditorSlideObservers } from '../features/editor/slide-observers.js';
import { createEditorArrowMover } from '../features/editor/arrow-movement.js';

function initEditor() {
    if (window._editorInitialized) return;
    window._editorInitialized = true;

    let _isLocked = false;
    window.setLocked = (locked) => {
        _isLocked = locked;
        if (locked) {
            document.body.classList.add('editor-locked');
            deselectGroup();
            isDragging = false;
            isResizing = false;
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

    // Basic state
    let selectedElement = null;
    let isDragging = false;
    let isResizing = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let _justSelected = false; // Flag to prevent immediate deselection
    let startWidth = 0, startHeight = 0;
    let currentHandle = null;
    let snapLinesX = [];
    let snapLinesY = [];
    let activeDragTarget = null;

    let dragGroup = [];

    // Track which slides have been "frozen" into absolute layout to avoid reflows
    const _isFrozenMap = new WeakMap();
    let _isRestoring = false; // Flag to prevent state saving during undo/redo

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
        getSelectedElement: () => selectedElement,
        deselect: () => deselectGroup(),
    });


    // Toolbar content
    function getToolbarHTML() {
        return renderEditorToolbarMarkup({
            window,
            selectedElement,
            palette: getDynamicPalette(),
            isImageSlotElement,
            isTextEditableElement,
        });
    }

    let activeColorAction = null; // 'text' or 'bg'

    function deleteElement(el) {
        return elementOperations.deleteElement(el);
    }

    function bindToolbarEvents() {
        const btnSizeDown = document.getElementById('editor-btn-size-down');
        const btnSizeUp = document.getElementById('editor-btn-size-up');
        const btnTextColor = document.getElementById('editor-btn-text-color');
        const btnBgColor = document.getElementById('editor-btn-bg-color');
        const btnDelete = document.getElementById('editor-btn-delete');
        const btnDuplicate = document.getElementById('editor-btn-duplicate');
        const btnReplaceImg = document.getElementById('editor-btn-replace-img');

        if (btnSizeDown) {
            btnSizeDown.addEventListener('click', (e) => {
                e.stopPropagation();
                changeFontSize(-2);
            });
        }

        if (btnSizeUp) {
            btnSizeUp.addEventListener('click', (e) => {
                e.stopPropagation();
                changeFontSize(2);
            });
        }

        if (btnTextColor) {
            btnTextColor.addEventListener('click', (e) => {
                e.stopPropagation();
                activeColorAction = 'text';
                showColorPicker(e.currentTarget);
            });
        }

        if (btnBgColor) {
            btnBgColor.addEventListener('click', (e) => {
                e.stopPropagation();
                activeColorAction = 'bg';
                showColorPicker(e.currentTarget);
            });
        }

        if (btnReplaceImg) {
            btnReplaceImg.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedElement) {
                    if (window.parent && window.parent._triggerImagePicker) {
                        window.parent._triggerImagePicker(selectedElement);
                    }
                }
            });
        }

        if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteElement(selectedElement);
            });
        }

        if (btnDuplicate) {
            btnDuplicate.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedElement) duplicateElement(selectedElement);
            });
        }

        // Quick colors binding if they exist
        toolbar.querySelectorAll('.editor-color-swatches-mini .editor-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedElement) {
                    saveState();
                    const color = swatch.dataset.color;
                    if (isTextEditableElement(selectedElement) || selectedElement.matches('button, i, svg, [data-lucide], .lucide, .lucide-icon')) {
                        selectedElement.style.color = color;
                        selectedElement.style.webkitTextFillColor = color;
                        // For SVGs, also try setting fill and stroke if they don't use currentColor
                        if (selectedElement.tagName.toLowerCase() === 'svg' || selectedElement.querySelector('svg')) {
                            const svg = selectedElement.tagName.toLowerCase() === 'svg' ? selectedElement : selectedElement.querySelector('svg');
                            // Only apply if it's not a complex SVG with multiple colors? 
                            // For simplicity, we just set the color. Lucide will handle it via currentColor.
                        }
                    } else {
                        selectedElement.style.backgroundColor = color;
                    }
                    window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element: selectedElement } }));
                }
            });
        });
    }

    bindToolbarEvents();

    function changeFontSize(delta) {
        if (!selectedElement) return;
        saveState();
        const style = window.getComputedStyle(selectedElement);
        const currentSize = parseFloat(style.fontSize) || 16;
        const newSize = Math.max(8, Math.min(200, currentSize + delta));
        selectedElement.style.fontSize = newSize + 'px';
        updateSizeDisplay();
    }

    function updateSizeDisplay() {
        const valEl = document.getElementById('editor-tb-size-val');
        if (selectedElement && valEl) {
            const style = window.getComputedStyle(selectedElement);
            valEl.textContent = Math.round(parseFloat(style.fontSize)) || 16;
        }
    }

    const { getDynamicPalette, showColorPicker } = createEditorColorPicker({
        document,
        window,
        getSelectedElement: () => selectedElement,
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
    window.freezeAllSlides = function () {
        document.querySelectorAll('section.s').forEach(slide => {
            if (_isFrozenMap.has(slide)) return;
            _isFrozenMap.set(slide, true);

            const allEditables = getEditableElementsInSlide(slide);
            if (allEditables.length === 0) return;

            const topLevel = getTopLevelEditableElements(slide);
            if (topLevel.length === 0) return;

            // Capture positions before any DOM mutation
            const data = topLevel.map(el => ({ el, rect: el.getBoundingClientRect() }));
            // Normalize silently — do NOT call saveState() to avoid polluting undo history
            data.forEach(({ el, rect }) => normalizeElement(el, slide, true, rect));
        });
    };

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

    /**
     * Helper to get all editable elements in the same slide, excluding the one being edited.
     */
    function getEditableElementsInSlide(slide, excludeEl) {
        if (!slide) return [];
        return getEditableElementsInNode(slide, excludeEl)
            .filter(el => {
                if (el === excludeEl) return false;
                if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
                if (el.matches(ignoreSelectors) || el.closest(ignoreSelectors)) return false;

                // Exclude children and ancestors of the current element
                if (excludeEl && (excludeEl.contains(el) || el.contains(excludeEl))) return false;

                return true;
            });
    }

    const editorGrouping = createEditorGrouping({ document, isSemanticContainer, getEditableElementsInSlide });



    document.body.addEventListener('mousedown', (e) => {
        if (_isLocked) return;
        ensureUI();

        // Ignore if clicking on our own tools
        if (e.target.closest('.editor-selection-box') || e.target.closest('.editor-toolbar') || e.target.closest('.editor-color-picker')) {
            return;
        }

        // Allow text cursor placement without dragging if already in edit mode
        if (e.target.closest('[contenteditable="true"]')) {
            return;
        }

        // Use elementsFromPoint to pierce z-index stacking
        // This allows selecting elements that are visually behind others
        const allUnderCursor = document.elementsFromPoint(e.clientX, e.clientY);

        // Find the best target: prefer the topmost editable that matches,
        // but if the user clicked directly on an editable (e.target), use that first.
        let target = findEditableTarget(e.target);

        // Special case: img-slots used as full-bleed backgrounds sit beneath
        // content wrappers (z-index:3), so findEditableTarget never reaches them.
        // If the direct click didn't land on a text element or an img-slot, scan
        // allUnderCursor and prefer any img-slot found there.
        if (!isImageSlotElement(target) && !isTextEditableElement(e.target)) {
            for (const el of allUnderCursor) {
                if (el.closest('.editor-selection-box') || el.closest('.editor-toolbar')) continue;
                if (isImageSlotElement(el)) {
                    target = el;
                    break;
                }
            }
        }

        // If no target found via native hit-test, scan all elements at this point
        if (!target) {
            for (const el of allUnderCursor) {
                if (el.closest('.editor-selection-box') || el.closest('.editor-toolbar')) continue;
                const match = findEditableTarget(el);
                if (match) {
                    target = match;
                    break;
                }
            }
        }

        if (target) {
            // Select it (visual only for now)
            selectElement(target);

            isDragging = true;
            dragGroup = [];
            activeDragTarget = getStableDragTarget(target);

            // We don't normalize (rip out of DOM) immediately on click.
            // We wait until the mouse actually moves to avoid breaking layouts on simple clicks.
            const rect = activeDragTarget.getBoundingClientRect();
            const slide = activeDragTarget.closest('.s') || activeDragTarget.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            startX = e.clientX;
            startY = e.clientY;

            startLeft = rect.left - slideRect.left;
            startTop = rect.top - slideRect.top;

            // Build snap targets
            const snapTargets = createEditorSnapTargets(slide, activeDragTarget, getEditableElementsInSlide);
            snapLinesX = snapTargets.snapLinesX;
            snapLinesY = snapTargets.snapLinesY;

            if (e.target.contentEditable !== 'true') {
                e.preventDefault();
            }
        } else {
            deselectGroup();
        }
    });

    // Cleanup _stateSavedSinceMousedown on mouseup
    document.addEventListener('mouseup', () => {
        isDragging = false;
        isResizing = false;
        currentHandle = null;
        dragGroup = [];
        activeDragTarget = null;
        guideH.style.display = 'none';
        guideV.style.display = 'none';

        if (selectedElement) {
            delete selectedElement._normalized;
            updateSelectionBox();
        }

        // Reset the flag for the next mousedown
        const allEditables = getAllEditableElements();
        allEditables.forEach(el => delete el._stateSavedSinceMousedown);
    });

    // Prevent click events on the selection UI from bubbling to the background deselect listener
    selectionBox.addEventListener('click', (e) => e.stopPropagation());
    toolbar.addEventListener('click', (e) => e.stopPropagation());

    // Handle double-click to edit text
    document.body.addEventListener('dblclick', createEditorDirectTextEditingHandler({
        document,
        window,
        selectionBox,
        getIsLocked: () => _isLocked,
        textEditableSelectors: TEXT_EDITABLE_SELECTORS,
        normalizeElement,
        saveState: () => saveState(),
    }));

    document.addEventListener('paste', createEditorPasteHandler({ document, window }));

    selectionBox.addEventListener('dblclick', createEditorTextEditingHandler({
        document,
        window,
        CustomEvent,
        selectionBox,
        getSelectedElement: () => selectedElement,
        getIsLocked: () => _isLocked,
        isTextEditableElement,
        normalizeElement,
        textEditableSelectors: TEXT_EDITABLE_SELECTORS,
        saveState: () => saveState(),
        selectElement: element => selectElement(element),
    }));

    selectionBox.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('editor-resize-handle')) {
            e.stopPropagation();
            if (!selectedElement) return;

            saveState(); // Save state before resize

            isResizing = true;
            currentHandle = e.target.dataset.handler;
            startX = e.clientX;
            startY = e.clientY;

            const rect = selectedElement.getBoundingClientRect();
            const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            startWidth = rect.width;
            startHeight = rect.height;
            startLeft = rect.left - slideRect.left;
            startTop = rect.top - slideRect.top;
            e.preventDefault();
        } else if (!e.target.classList.contains('editor-resize-handle')) {
            // Drag via selection box proxy (anywhere that isn't a handle)
            e.stopPropagation();
            if (!selectedElement) return;

            saveState(); // Save state before drag

            isDragging = true;
            dragGroup = [];
            activeDragTarget = getStableDragTarget(selectedElement);

            const rect = activeDragTarget.getBoundingClientRect();
            const slide = activeDragTarget.closest('.s') || activeDragTarget.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            startX = e.clientX;
            startY = e.clientY;

            startLeft = rect.left - slideRect.left;
            startTop = rect.top - slideRect.top;

            e.preventDefault();
        }
    });


    document.addEventListener('mousemove', (e) => {
        const currentElement = activeDragTarget || selectedElement;
        if (!currentElement) return;

        const slide = currentElement.closest('.s') || currentElement.closest('section') || document.body;

        if (isDragging || isResizing) {
            const dx = (e.clientX - startX);
            const dy = (e.clientY - startY);

            // NORMALIZATION ON DEMAND: Rip out of DOM when user actually starts transforming.
            if (!currentElement._normalized && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                if (isDragging && activeDragTarget && activeDragTarget !== selectedElement) {
                    selectElement(activeDragTarget);
                }

                normalizeElement(currentElement, slide);

                // If the chosen drag target still isn't absolutely positioned, abort the drag.
                // This keeps unrelated elements untouched instead of extracting siblings.
                if (currentElement.style.position !== 'absolute') {
                    isDragging = false;
                    activeDragTarget = null;
                    updateSelectionBox();
                    return;
                }

                // After normalization, we MUST reset the base values because style.left/top
                // might differ from the visual start coordinates captured in mousedown.
                startWidth = parseFloat(currentElement.style.width);
                const _rawH = parseFloat(currentElement.style.height);
                startHeight = isNaN(_rawH) ? currentElement.getBoundingClientRect().height : _rawH;
                startLeft = parseFloat(currentElement.style.left);
                startTop = parseFloat(currentElement.style.top);

                startX = e.clientX;
                startY = e.clientY;
            }
        }

        if (isDragging) {
            applyEditorDrag(e, {
                currentElement,
                selectedElement,
                slide,
                startX,
                startY,
                startLeft,
                startTop,
                snapLinesX,
                snapLinesY,
                guideH,
                guideV,
                updateSelectionBox,
            });
        } else if (isResizing) {
            applyEditorResize(e, {
                selectedElement,
                slide,
                startX,
                startY,
                startLeft,
                startTop,
                startWidth,
                startHeight,
                currentHandle,
                snapLinesX,
                snapLinesY,
                guideH,
                guideV,
                updateSelectionBox,
            });
        }
    });

    const updateSelectionBox = createEditorSelectionUi({
        getSelectedElement: () => selectedElement,
        selectionBox,
        toolbar,
        window,
        getIsDragging: () => isDragging,
        getIsResizing: () => isResizing,
        calculateGeometry: calculateEditorSelectionGeometry,
    });

    const { selectElement, deselectGroup } = createEditorSelectionLifecycle({
        document,
        window,
        MutationObserver,
        ResizeObserver,
        CustomEvent,
        setTimeout,
        getSelectedElement: () => selectedElement,
        setSelectedElement: element => { selectedElement = element; },
        getIsLocked: () => _isLocked,
        setJustSelected: value => { _justSelected = value; },
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
        getIsRestoring: () => _isRestoring,
        setIsRestoring: value => { _isRestoring = value; },
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
        getSelectedElement: () => selectedElement,
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
        getSelectedElement: () => selectedElement,
        getIsLocked: () => _isLocked,
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
        getSelectedElement: () => selectedElement,
        getIsJustSelected: () => _justSelected,
        getIsDragging: () => isDragging,
        getIsResizing: () => isResizing,
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
