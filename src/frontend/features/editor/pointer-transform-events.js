/** Installs the iframe editor's existing document-level drag/resize move listener.
 * @param {{document: Document, getState: () => object, updateState: (patch: object) => void, normalizeElement: (element: Element, slide: Element) => void, selectElement: (element: Element) => void, updateSelectionBox: () => void, applyEditorDrag: Function, applyEditorResize: Function, guideH: HTMLElement, guideV: HTMLElement}} dependencies
 */
export function installEditorPointerTransformEvents({
    document,
    getState,
    updateState,
    normalizeElement,
    selectElement,
    updateSelectionBox,
    applyEditorDrag,
    applyEditorResize,
    guideH,
    guideV,
}) {
    document.addEventListener('mousemove', (event) => {
        let state = getState();
        const currentElement = state.activeDragTarget || state.selectedElement;
        if (!currentElement) return;

        const slide = currentElement.closest('.s') || currentElement.closest('section') || document.body;

        if (state.isDragging || state.isResizing) {
            const dx = (event.clientX - state.startX);
            const dy = (event.clientY - state.startY);

            // NORMALIZATION ON DEMAND: Rip out of DOM when user actually starts transforming.
            if (!currentElement._normalized && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                if (state.isDragging && state.activeDragTarget && state.activeDragTarget !== state.selectedElement) {
                    selectElement(state.activeDragTarget);
                    state = getState();
                }

                normalizeElement(currentElement, slide);

                // If the chosen drag target still isn't absolutely positioned, abort the drag.
                // This keeps unrelated elements untouched instead of extracting siblings.
                if (currentElement.style.position !== 'absolute') {
                    updateState({ isDragging: false, activeDragTarget: null });
                    updateSelectionBox();
                    return;
                }

                // After normalization, reset the base values because style.left/top might differ.
                const startWidth = parseFloat(currentElement.style.width);
                const rawHeight = parseFloat(currentElement.style.height);
                const nextState = {
                    startWidth,
                    startHeight: isNaN(rawHeight) ? currentElement.getBoundingClientRect().height : rawHeight,
                    startLeft: parseFloat(currentElement.style.left),
                    startTop: parseFloat(currentElement.style.top),
                    startX: event.clientX,
                    startY: event.clientY,
                };
                updateState(nextState);
                Object.assign(state, nextState);
            }
        }

        if (state.isDragging) {
            applyEditorDrag(event, {
                currentElement,
                selectedElement: state.selectedElement,
                slide,
                startX: state.startX,
                startY: state.startY,
                startLeft: state.startLeft,
                startTop: state.startTop,
                snapLinesX: state.snapLinesX,
                snapLinesY: state.snapLinesY,
                guideH,
                guideV,
                updateSelectionBox,
            });
        } else if (state.isResizing) {
            applyEditorResize(event, {
                selectedElement: state.selectedElement,
                slide,
                startX: state.startX,
                startY: state.startY,
                startLeft: state.startLeft,
                startTop: state.startTop,
                startWidth: state.startWidth,
                startHeight: state.startHeight,
                currentHandle: state.currentHandle,
                snapLinesX: state.snapLinesX,
                snapLinesY: state.snapLinesY,
                guideH,
                guideV,
                updateSelectionBox,
            });
        }
    });
}
