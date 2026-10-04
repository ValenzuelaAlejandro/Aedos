/** @typedef {{isDragging: boolean, activeDragTarget: Element|null, selectedElement: Element|null, startWidth: number, startHeight: number, startLeft: number, startTop: number, startX: number, startY: number}} EditorPointerState */

/**
 * Normalize a pointer target only after the legacy three-pixel movement
 * threshold, then reset its geometry origin. Returns true when the caller must
 * abort this mousemove because normalization did not produce absolute layout.
 * @param {MouseEvent} event
 * @param {Element} currentElement
 * @param {Element} slide
 * @param {EditorPointerState} pointerState
 * @param {(element: Element, slide: Element) => void} normalizeElement
 * @param {(element: Element) => void} selectElement
 * @param {() => void} updateSelectionBox
 * @returns {boolean}
 */
export function normalizePointerTarget(event, currentElement, slide, pointerState, normalizeElement, selectElement, updateSelectionBox) {
    const dx = event.clientX - pointerState.startX;
    const dy = event.clientY - pointerState.startY;
    if (currentElement._normalized || !(Math.abs(dx) > 3 || Math.abs(dy) > 3)) return false;

    if (pointerState.isDragging && pointerState.activeDragTarget && pointerState.activeDragTarget !== pointerState.selectedElement) {
        selectElement(pointerState.activeDragTarget);
    }

    normalizeElement(currentElement, slide);

    // If the chosen drag target still isn't absolutely positioned, abort the drag.
    // This keeps unrelated elements untouched instead of extracting siblings.
    if (currentElement.style.position !== 'absolute') {
        pointerState.isDragging = false;
        pointerState.activeDragTarget = null;
        updateSelectionBox();
        return true;
    }

    // After normalization, reset the base values because style.left/top can differ
    // from the visual start coordinates captured in mousedown.
    pointerState.startWidth = parseFloat(currentElement.style.width);
    const rawHeight = parseFloat(currentElement.style.height);
    pointerState.startHeight = isNaN(rawHeight) ? currentElement.getBoundingClientRect().height : rawHeight;
    pointerState.startLeft = parseFloat(currentElement.style.left);
    pointerState.startTop = parseFloat(currentElement.style.top);
    pointerState.startX = event.clientX;
    pointerState.startY = event.clientY;
    return false;
}
