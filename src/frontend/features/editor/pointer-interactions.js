import { applyEditorResize } from './resize-interaction.js';
import { applyEditorDrag } from './drag-interaction.js';
import { beginEditorResize } from './resize-start.js';
import { normalizePointerTarget } from './pointer-normalization.js';

/**
 * @typedef {Object} EditorPointerInteractionDependencies
 * @property {Document} document
 * @property {HTMLElement} selectionBox
 * @property {Object} pointerState
 * @property {Function} saveState
 * @property {Function} getStableDragTarget
 * @property {Function} normalizeElement
 * @property {Function} selectElement
 * @property {Function} updateSelectionBox
 * @property {HTMLElement} guideH
 * @property {HTMLElement} guideV
 */

/**
 * Register selection-box resize and document drag/resize movement handlers.
 * Keep this factory invocation at the former registration site in editor.js.
 * @param {EditorPointerInteractionDependencies} deps
 */
export function bindEditorPointerInteractions(deps) {
    const {
        document,
        selectionBox,
        pointerState,
        saveState,
        getStableDragTarget,
        normalizeElement,
        selectElement,
        updateSelectionBox,
        guideH,
        guideV,
    } = deps;

    selectionBox.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('editor-resize-handle')) {
            e.stopPropagation();
            beginEditorResize(e, pointerState, document, () => saveState());
        } else if (!e.target.classList.contains('editor-resize-handle')) {
            // Drag via selection box proxy (anywhere that isn't a handle)
            e.stopPropagation();
            if (!pointerState.selectedElement) return;

            saveState(); // Save state before drag

            pointerState.isDragging = true;
            pointerState.dragGroup = [];
            pointerState.activeDragTarget = getStableDragTarget(pointerState.selectedElement);

            const rect = pointerState.activeDragTarget.getBoundingClientRect();
            const slide = pointerState.activeDragTarget.closest('.s') || pointerState.activeDragTarget.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            pointerState.startX = e.clientX;
            pointerState.startY = e.clientY;

            pointerState.startLeft = rect.left - slideRect.left;
            pointerState.startTop = rect.top - slideRect.top;

            e.preventDefault();
        }
    });

    document.addEventListener('mousemove', (e) => {
        const currentElement = pointerState.activeDragTarget || pointerState.selectedElement;
        if (!currentElement) return;

        const slide = currentElement.closest('.s') || currentElement.closest('section') || document.body;

        if (pointerState.isDragging || pointerState.isResizing) {
            // NORMALIZATION ON DEMAND: Rip out of DOM when user actually starts transforming.
            if (normalizePointerTarget(e, currentElement, slide, pointerState, normalizeElement, element => selectElement(element), () => updateSelectionBox())) return;
        }

        if (pointerState.isDragging) {
            applyEditorDrag(e, {
                currentElement,
                selectedElement: pointerState.selectedElement,
                slide,
                startX: pointerState.startX,
                startY: pointerState.startY,
                startLeft: pointerState.startLeft,
                startTop: pointerState.startTop,
                snapLinesX: pointerState.snapLinesX,
                snapLinesY: pointerState.snapLinesY,
                guideH,
                guideV,
                updateSelectionBox,
            });
        } else if (pointerState.isResizing) {
            applyEditorResize(e, {
                selectedElement: pointerState.selectedElement,
                slide,
                startX: pointerState.startX,
                startY: pointerState.startY,
                startLeft: pointerState.startLeft,
                startTop: pointerState.startTop,
                startWidth: pointerState.startWidth,
                startHeight: pointerState.startHeight,
                currentHandle: pointerState.currentHandle,
                snapLinesX: pointerState.snapLinesX,
                snapLinesY: pointerState.snapLinesY,
                guideH,
                guideV,
                updateSelectionBox,
            });
        }
    });
}
