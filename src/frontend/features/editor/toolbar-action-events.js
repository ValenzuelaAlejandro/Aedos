/** @typedef {{document: Document, window: Window, getSelectedElement: () => Element|null, showColorPicker: (anchor: Element) => void, replaceImage: (element: Element|null) => void, deleteSelected: () => void, duplicateSelected: () => void}} EditorToolbarActionEventsOptions */

/** Bind the existing toolbar action controls in their original order.
 * @param {EditorToolbarActionEventsOptions} options
 */
export function bindEditorToolbarActionEvents({
    document,
    window,
    getSelectedElement,
    showColorPicker,
    replaceImage,
    deleteSelected,
    duplicateSelected,
}) {
    const btnTextColor = document.getElementById('editor-btn-text-color');
    const btnBgColor = document.getElementById('editor-btn-bg-color');
    const btnDelete = document.getElementById('editor-btn-delete');
    const btnDuplicate = document.getElementById('editor-btn-duplicate');
    const btnReplaceImg = document.getElementById('editor-btn-replace-img');

    if (btnTextColor) {
        btnTextColor.addEventListener('click', e => {
            e.stopPropagation();
            showColorPicker('text', e.currentTarget);
        });
    }

    if (btnBgColor) {
        btnBgColor.addEventListener('click', e => {
            e.stopPropagation();
            showColorPicker('bg', e.currentTarget);
        });
    }

    if (btnReplaceImg) {
        btnReplaceImg.addEventListener('click', e => {
            e.stopPropagation();
            if (getSelectedElement() && window.parent && window.parent._triggerImagePicker) {
                replaceImage(getSelectedElement());
            }
        });
    }

    if (btnDelete) {
        btnDelete.addEventListener('click', e => {
            e.stopPropagation();
            deleteSelected();
        });
    }

    if (btnDuplicate) {
        btnDuplicate.addEventListener('click', e => {
            e.stopPropagation();
            if (getSelectedElement()) duplicateSelected();
        });
    }
}
