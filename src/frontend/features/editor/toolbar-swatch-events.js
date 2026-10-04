/** @typedef {{toolbar: HTMLElement, getSelectedElement: () => Element|null, saveState: () => void, isTextEditableElement: (element: Element) => boolean, dispatchSelectionChanged: (element: Element) => void}} EditorToolbarSwatchEventsOptions */

/** Bind the current toolbar palette swatches in their existing DOM order.
 * @param {EditorToolbarSwatchEventsOptions} options
 */
export function bindEditorToolbarSwatchEvents({
    toolbar,
    getSelectedElement,
    saveState,
    isTextEditableElement,
    dispatchSelectionChanged,
}) {
    toolbar.querySelectorAll('.editor-color-swatches-mini .editor-color-swatch').forEach(swatch => {
        swatch.addEventListener('click', e => {
            e.stopPropagation();
            const selectedElement = getSelectedElement();
            if (!selectedElement) return;
            saveState();
            const color = swatch.dataset.color;
            if (isTextEditableElement(selectedElement) || selectedElement.matches('button, i, svg, [data-lucide], .lucide, .lucide-icon')) {
                selectedElement.style.color = color;
                selectedElement.style.webkitTextFillColor = color;
                if (selectedElement.tagName.toLowerCase() === 'svg' || selectedElement.querySelector('svg')) {
                    const svg = selectedElement.tagName.toLowerCase() === 'svg' ? selectedElement : selectedElement.querySelector('svg');
                }
            } else {
                selectedElement.style.backgroundColor = color;
            }
            dispatchSelectionChanged(selectedElement);
        });
    });
}
