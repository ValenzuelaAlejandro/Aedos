/** Installs the existing selection-box mouse-down resize/drag initiation handler.
 * @param {{selectionBox: Element, getState: () => object, updateState: (patch: object) => void, saveState: () => void, getStableDragTarget: (element: Element) => Element, document: Document}} dependencies
 */
export function installEditorPointerStartEvents({
    selectionBox,
    getState,
    updateState,
    saveState,
    getStableDragTarget,
    document,
}) {
    selectionBox.addEventListener('mousedown', (event) => {
        if (event.target.classList.contains('editor-resize-handle')) {
            event.stopPropagation();
            const { selectedElement } = getState();
            if (!selectedElement) return;

            saveState(); // Save state before resize
            updateState({
                isResizing: true,
                currentHandle: event.target.dataset.handler,
                startX: event.clientX,
                startY: event.clientY,
            });

            const rect = selectedElement.getBoundingClientRect();
            const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();
            updateState({
                startWidth: rect.width,
                startHeight: rect.height,
                startLeft: rect.left - slideRect.left,
                startTop: rect.top - slideRect.top,
            });
            event.preventDefault();
        } else if (!event.target.classList.contains('editor-resize-handle')) {
            // Drag via selection box proxy (anywhere that isn't a handle)
            event.stopPropagation();
            const { selectedElement } = getState();
            if (!selectedElement) return;

            saveState(); // Save state before drag
            const activeDragTarget = getStableDragTarget(selectedElement);
            updateState({ isDragging: true, dragGroup: [], activeDragTarget });
            const rect = activeDragTarget.getBoundingClientRect();
            const slide = activeDragTarget.closest('.s') || activeDragTarget.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();
            updateState({
                startX: event.clientX,
                startY: event.clientY,
                startLeft: rect.left - slideRect.left,
                startTop: rect.top - slideRect.top,
            });
            event.preventDefault();
        }
    });
}
