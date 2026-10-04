/** @typedef {{document: Document, toolbar: Element, window: Window, CustomEvent: typeof CustomEvent, getSelectedElement: () => Element|null, saveState: () => void, setActiveColorAction: (action: 'text'|'bg') => void, showColorPicker: (anchor: Element) => void, changeFontSize: (delta: number) => void, deleteElement: (element: Element|null) => void, duplicateElement: (element: Element) => void, isTextEditableElement: (element: Element) => boolean}} AedosEditorToolbarEventOptions */

/** Registers editor toolbar listeners without owning editor state. @param {AedosEditorToolbarEventOptions} options */
export function bindEditorToolbarEvents({ document, toolbar, window, CustomEvent, getSelectedElement, saveState, setActiveColorAction, showColorPicker, changeFontSize, deleteElement, duplicateElement, isTextEditableElement }) {
    const btnSizeDown = document.getElementById('editor-btn-size-down');
    const btnSizeUp = document.getElementById('editor-btn-size-up');
    const btnTextColor = document.getElementById('editor-btn-text-color');
    const btnBgColor = document.getElementById('editor-btn-bg-color');
    const btnDelete = document.getElementById('editor-btn-delete');
    const btnDuplicate = document.getElementById('editor-btn-duplicate');
    const btnReplaceImg = document.getElementById('editor-btn-replace-img');

    if (btnSizeDown) btnSizeDown.addEventListener('click', e => { e.stopPropagation(); changeFontSize(-2); });
    if (btnSizeUp) btnSizeUp.addEventListener('click', e => { e.stopPropagation(); changeFontSize(2); });
    if (btnTextColor) btnTextColor.addEventListener('click', e => {
        e.stopPropagation(); setActiveColorAction('text'); showColorPicker(e.currentTarget);
    });
    if (btnBgColor) btnBgColor.addEventListener('click', e => {
        e.stopPropagation(); setActiveColorAction('bg'); showColorPicker(e.currentTarget);
    });
    if (btnReplaceImg) btnReplaceImg.addEventListener('click', e => {
        e.stopPropagation();
        const selectedElement = getSelectedElement();
        if (selectedElement && window.parent && window.parent._triggerImagePicker) window.parent._triggerImagePicker(selectedElement);
    });
    if (btnDelete) btnDelete.addEventListener('click', e => { e.stopPropagation(); deleteElement(getSelectedElement()); });
    if (btnDuplicate) btnDuplicate.addEventListener('click', e => {
        e.stopPropagation();
        const selectedElement = getSelectedElement();
        if (selectedElement) duplicateElement(selectedElement);
    });

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
                    // Existing SVG fill/stroke path intentionally relies on currentColor.
                    void svg;
                }
            } else {
                selectedElement.style.backgroundColor = color;
            }
            window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element: selectedElement } }));
        });
    });
}
