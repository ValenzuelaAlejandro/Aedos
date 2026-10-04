/** @typedef {{document: Document, toolbar: Element, window: Window, CustomEvent: typeof CustomEvent, getSelectedElement: () => Element|null, saveState: () => void, setActiveColorAction: (action: 'text'|'bg') => void, showColorPicker: (anchor: Element) => void, changeFontSize: (delta: number) => void, deleteElement: (element: Element|null) => void, duplicateElement: (element: Element) => void, isTextEditableElement: (element: Element) => boolean}} AedosEditorToolbarEventOptions */

/** Registers the existing toolbar actions. @param {AedosEditorToolbarEventOptions} options */
export function bindEditorToolbarEvents({ document, toolbar, window, CustomEvent, getSelectedElement, saveState, setActiveColorAction, showColorPicker, changeFontSize, deleteElement, duplicateElement, isTextEditableElement }) {
    const controls = {
        sizeDown: document.getElementById('editor-btn-size-down'),
        sizeUp: document.getElementById('editor-btn-size-up'),
        textColor: document.getElementById('editor-btn-text-color'),
        bgColor: document.getElementById('editor-btn-bg-color'),
        delete: document.getElementById('editor-btn-delete'),
        duplicate: document.getElementById('editor-btn-duplicate'),
        replace: document.getElementById('editor-btn-replace-img'),
    };
    if (controls.sizeDown) controls.sizeDown.addEventListener('click', e => { e.stopPropagation(); changeFontSize(-2); });
    if (controls.sizeUp) controls.sizeUp.addEventListener('click', e => { e.stopPropagation(); changeFontSize(2); });
    if (controls.textColor) controls.textColor.addEventListener('click', e => { e.stopPropagation(); setActiveColorAction('text'); showColorPicker(e.currentTarget); });
    if (controls.bgColor) controls.bgColor.addEventListener('click', e => { e.stopPropagation(); setActiveColorAction('bg'); showColorPicker(e.currentTarget); });
    if (controls.replace) controls.replace.addEventListener('click', e => {
        e.stopPropagation();
        const element = getSelectedElement();
        if (element && window.parent && window.parent._triggerImagePicker) window.parent._triggerImagePicker(element);
    });
    if (controls.delete) controls.delete.addEventListener('click', e => { e.stopPropagation(); deleteElement(getSelectedElement()); });
    if (controls.duplicate) controls.duplicate.addEventListener('click', e => {
        e.stopPropagation();
        const element = getSelectedElement();
        if (element) duplicateElement(element);
    });

    toolbar.querySelectorAll('.editor-color-swatches-mini .editor-color-swatch').forEach(swatch => {
        swatch.addEventListener('click', e => {
            e.stopPropagation();
            const element = getSelectedElement();
            if (!element) return;
            saveState();
            const color = swatch.dataset.color;
            if (isTextEditableElement(element) || element.matches('button, i, svg, [data-lucide], .lucide, .lucide-icon')) {
                element.style.color = color;
                element.style.webkitTextFillColor = color;
                if (element.tagName.toLowerCase() === 'svg' || element.querySelector('svg')) {
                    const svg = element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg');
                    void svg;
                }
            } else {
                element.style.backgroundColor = color;
            }
            window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element } }));
        });
    });
}
