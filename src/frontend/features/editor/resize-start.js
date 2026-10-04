/** @typedef {{selectedElement: Element|null, isResizing: boolean, currentHandle: string|null, startX: number, startY: number, startWidth: number, startHeight: number, startLeft: number, startTop: number}} EditorPointerState */

/** Capture the existing selection-box resize starting state. @param {MouseEvent} event @param {EditorPointerState} pointerState @param {Document} document @param {() => void} saveState */
export function beginEditorResize(event, pointerState, document, saveState) {
    if (!pointerState.selectedElement) return;

    saveState(); // Save state before resize

    pointerState.isResizing = true;
    pointerState.currentHandle = event.target.dataset.handler;
    pointerState.startX = event.clientX;
    pointerState.startY = event.clientY;

    const rect = pointerState.selectedElement.getBoundingClientRect();
    const slide = pointerState.selectedElement.closest('.s') || pointerState.selectedElement.closest('section') || document.body;
    const slideRect = slide.getBoundingClientRect();

    pointerState.startWidth = rect.width;
    pointerState.startHeight = rect.height;
    pointerState.startLeft = rect.left - slideRect.left;
    pointerState.startTop = rect.top - slideRect.top;
    event.preventDefault();
}
