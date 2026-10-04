/**
 * @typedef {object} AedosEditorToolbarMarkupOptions
 * @property {() => Element|null} getSelectedElement
 * @property {() => string[]} getDynamicPalette
 * @property {(element: Element) => boolean} isImageSlotElement
 * @property {(element: Element) => boolean} isTextEditableElement
 * @property {(key: string, fallback: string) => string} translate
 */

/** Creates the editor's existing toolbar HTML based on the current target. @param {AedosEditorToolbarMarkupOptions} options @returns {() => string} */
export function createEditorToolbarMarkup({
    getSelectedElement,
    getDynamicPalette,
    isImageSlotElement,
    isTextEditableElement,
    translate,
}) {
    return function getToolbarHTML() {
        const selectedElement = getSelectedElement();
        if (!selectedElement) return '';

        const palette = getDynamicPalette().slice(0, 4);
        const quickColorsHTML = palette.map(color => `
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
                    <button class="editor-tb-btn" id="editor-btn-size-down" title="${translate('smaller', 'Smaller')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                    <div class="editor-tb-size-val" id="editor-tb-size-val">16</div>
                    <button class="editor-tb-btn" id="editor-btn-size-up" title="${translate('bigger', 'Bigger')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                </div>
                <div class="editor-divider"></div>
                <button class="editor-tb-btn" id="editor-btn-text-color" title="${translate('text_color', 'Text Color')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16M6 16l6-12 6 12M8 12h8"></path></svg></button>
            `;
        } else if (isImage) {
            toolsHTML = `
                <button class="editor-tb-btn" id="editor-btn-replace-img" title="${translate('replace_image', 'Replace Image')}" style="width: auto; padding: 0 10px; border-radius: 20px; gap: 6px; font-size: 12px; font-weight: 600;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    ${translate('replace', 'Replace')}
                </button>
            `;
        } else {
            toolsHTML = `
                <div class="editor-color-swatches-mini">${quickColorsHTML}</div>
                <div class="editor-divider"></div>
                <button class="editor-tb-btn" id="editor-btn-bg-color" title="${translate('fill_color', 'Fill Color')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path></svg></button>
            `;
        }

        return `
            ${toolsHTML}
            <div class="editor-divider"></div>
            <button class="editor-tb-btn" id="editor-btn-duplicate" title="${translate('duplicate_element', 'Duplicate')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button>
            <button class="editor-tb-btn" id="editor-btn-delete" title="${translate('delete_element', 'Delete')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg></button>
            <div id="editor-color-picker" class="editor-color-picker" style="display:none;"></div>
        `;
    };
}
