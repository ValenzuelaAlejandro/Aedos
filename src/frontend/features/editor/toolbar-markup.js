/** @typedef {{window: Window, selectedElement: Element, palette: string[], isImageSlotElement: (element: Element) => boolean, isTextEditableElement: (element: Element) => boolean}} AedosToolbarMarkupOptions */

/** Renders the existing floating editor toolbar markup. @param {AedosToolbarMarkupOptions} options @returns {string} */
export function renderEditorToolbarMarkup({ window, selectedElement, palette, isImageSlotElement, isTextEditableElement }) {
    if (!selectedElement) return '';
    const quickColorsHTML = palette.slice(0, 4).map(color => `
            <div class="editor-color-swatch" style="background:${color};" data-color="${color}"></div>
        `).join('');
    const isImage = selectedElement.matches('img') || isImageSlotElement(selectedElement);
    const isText = isTextEditableElement(selectedElement);
    let toolsHTML = '';

    if (isText) {
        toolsHTML = `
                <div class="editor-color-swatches-mini">${quickColorsHTML}</div>
                <div class="editor-divider"></div>
                <div class="editor-tb-size-wrap">
                    <button class="editor-tb-btn" id="editor-btn-size-down" title="${window.parent.__t('smaller', 'Smaller')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                    <div class="editor-tb-size-val" id="editor-tb-size-val">16</div>
                    <button class="editor-tb-btn" id="editor-btn-size-up" title="${window.parent.__t('bigger', 'Bigger')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                </div>
                <div class="editor-divider"></div>
                <button class="editor-tb-btn" id="editor-btn-text-color" title="${window.parent.__t('text_color', 'Text Color')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16M6 16l6-12 6 12M8 12h8"></path></svg></button>
            `;
    } else if (isImage) {
        toolsHTML = `
                <button class="editor-tb-btn" id="editor-btn-replace-img" title="${window.parent.__t('replace_image', 'Replace Image')}" style="width: auto; padding: 0 10px; border-radius: 20px; gap: 6px; font-size: 12px; font-weight: 600;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    ${window.parent.__t('replace', 'Replace')}
                </button>
            `;
    } else {
        toolsHTML = `
                <div class="editor-color-swatches-mini">${quickColorsHTML}</div>
                <div class="editor-divider"></div>
                <button class="editor-tb-btn" id="editor-btn-bg-color" title="${window.parent.__t('fill_color', 'Fill Color')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path></svg></button>
            `;
    }

    return `
            ${toolsHTML}
            <div class="editor-divider"></div>
            <button class="editor-tb-btn" id="editor-btn-duplicate" title="${window.parent.__t('duplicate_element', 'Duplicate')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="14" height="14" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button>
            <button class="editor-tb-btn" id="editor-btn-delete" title="${window.parent.__t('delete_element', 'Delete')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg></button>
            <div id="editor-color-picker" class="editor-color-picker" style="display:none;"></div>
        `;
}

/** Binds the existing toolbar actions through the editor's live state callbacks.
 * @param {{document: Document, window: Window, CustomEvent: typeof CustomEvent, toolbar: Element, getSelectedElement: () => Element|null, getActiveColorAction: () => string|null, setActiveColorAction: (action: string) => void, changeFontSize: (delta: number) => void, showColorPicker: (anchor: Element) => void, deleteElement: (element: Element|null) => void, duplicateElement: (element: Element) => void, saveState: () => void, isTextEditableElement: (element: Element) => boolean}} dependencies
 */
export function bindEditorToolbarEvents({
    document,
    window,
    CustomEvent,
    toolbar,
    getSelectedElement,
    setActiveColorAction,
    changeFontSize,
    showColorPicker,
    deleteElement,
    duplicateElement,
    saveState,
    isTextEditableElement,
}) {
    const btnSizeDown = document.getElementById('editor-btn-size-down');
    const btnSizeUp = document.getElementById('editor-btn-size-up');
    const btnTextColor = document.getElementById('editor-btn-text-color');
    const btnBgColor = document.getElementById('editor-btn-bg-color');
    const btnDelete = document.getElementById('editor-btn-delete');
    const btnDuplicate = document.getElementById('editor-btn-duplicate');
    const btnReplaceImg = document.getElementById('editor-btn-replace-img');

    if (btnSizeDown) btnSizeDown.addEventListener('click', event => {
        event.stopPropagation();
        changeFontSize(-2);
    });
    if (btnSizeUp) btnSizeUp.addEventListener('click', event => {
        event.stopPropagation();
        changeFontSize(2);
    });
    if (btnTextColor) btnTextColor.addEventListener('click', event => {
        event.stopPropagation();
        setActiveColorAction('text');
        showColorPicker(event.currentTarget);
    });
    if (btnBgColor) btnBgColor.addEventListener('click', event => {
        event.stopPropagation();
        setActiveColorAction('bg');
        showColorPicker(event.currentTarget);
    });
    if (btnReplaceImg) btnReplaceImg.addEventListener('click', event => {
        event.stopPropagation();
        const selectedElement = getSelectedElement();
        if (selectedElement && window.parent && window.parent._triggerImagePicker) {
            window.parent._triggerImagePicker(selectedElement);
        }
    });
    if (btnDelete) btnDelete.addEventListener('click', event => {
        event.stopPropagation();
        deleteElement(getSelectedElement());
    });
    if (btnDuplicate) btnDuplicate.addEventListener('click', event => {
        event.stopPropagation();
        const selectedElement = getSelectedElement();
        if (selectedElement) duplicateElement(selectedElement);
    });

    toolbar.querySelectorAll('.editor-color-swatches-mini .editor-color-swatch').forEach(swatch => {
        swatch.addEventListener('click', event => {
            event.stopPropagation();
            const selectedElement = getSelectedElement();
            if (!selectedElement) return;
            saveState();
            const color = swatch.dataset.color;
            if (isTextEditableElement(selectedElement) || selectedElement.matches('button, i, svg, [data-lucide], .lucide, .lucide-icon')) {
                selectedElement.style.color = color;
                selectedElement.style.webkitTextFillColor = color;
                if (selectedElement.tagName.toLowerCase() === 'svg' || selectedElement.querySelector('svg')) {
                    const svg = selectedElement.tagName.toLowerCase() === 'svg' ? selectedElement : selectedElement.querySelector('svg');
                    // Lucide icons inherit currentColor; keep the legacy lookup for SVG descendants.
                    void svg;
                }
            } else {
                selectedElement.style.backgroundColor = color;
            }
            window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element: selectedElement } }));
        });
    });
}
