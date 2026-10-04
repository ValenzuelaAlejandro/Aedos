import { initializePointerSnapGuides } from './pointer-snap-guides.js';

/** @typedef {{isLocked: boolean, isDragging: boolean, dragGroup: Element[], activeDragTarget: Element|null, startX: number, startY: number, startLeft: number, startTop: number, snapLinesX: Array<{val: number}>, snapLinesY: Array<{val: number}>}} EditorPointerState */

/**
 * Register the editor's original body mousedown handler for pointer selection
 * and drag initialization.
 * @param {{document: Document, pointerState: EditorPointerState, ensureUI: () => void, findEditableTarget: (element: Element) => Element|null, isImageSlotElement: (element: Element|null) => boolean, isTextEditableElement: (element: Element) => boolean, selectElement: (element: Element) => void, deselectGroup: () => void, getStableDragTarget: (element: Element) => Element, createSnapTargets: Function, getEditableElementsInSlide: Function}} dependencies
 */
export function bindEditorBodyPointerDown({
    document,
    pointerState,
    ensureUI,
    findEditableTarget,
    isImageSlotElement,
    isTextEditableElement,
    selectElement,
    deselectGroup,
    getStableDragTarget,
    createSnapTargets,
    getEditableElementsInSlide,
}) {
    document.body.addEventListener('mousedown', (e) => {
        if (pointerState.isLocked) return;
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

            pointerState.isDragging = true;
            pointerState.dragGroup = [];
            pointerState.activeDragTarget = getStableDragTarget(target);

            // We don't normalize (rip out of DOM) immediately on click.
            // We wait until the mouse actually moves to avoid breaking layouts on simple clicks.
            const rect = pointerState.activeDragTarget.getBoundingClientRect();
            const slide = pointerState.activeDragTarget.closest('.s') || pointerState.activeDragTarget.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            pointerState.startX = e.clientX;
            pointerState.startY = e.clientY;

            pointerState.startLeft = rect.left - slideRect.left;
            pointerState.startTop = rect.top - slideRect.top;

            // Build snap targets
            initializePointerSnapGuides(slide, pointerState.activeDragTarget, pointerState, createSnapTargets, getEditableElementsInSlide);

            if (e.target.contentEditable !== 'true') {
                e.preventDefault();
            }
        } else {
            deselectGroup();
        }
    });
}
