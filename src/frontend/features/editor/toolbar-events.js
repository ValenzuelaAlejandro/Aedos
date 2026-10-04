/** @typedef {object} AedosEditorToolbarEventOptions
 * @property {Document} document
 * @property {Window} window
 * @property {typeof CustomEvent} CustomEvent
 * @property {HTMLElement} toolbar
 * @property {() => Element|null} getSelectedElement
 * @property {(action: string) => void} setActiveColorAction
 * @property {(delta: number) => void} changeFontSize
 * @property {(anchor: Element) => void} showColorPicker
 * @property {(element: Element|null) => void} deleteElement
 * @property {(element: Element) => void} duplicateElement
 * @property {() => void} saveState
 * @property {(element: Element) => boolean} isTextEditableElement
 */

/** Creates the existing toolbar listener binder in its original registration order. @param {AedosEditorToolbarEventOptions} options @returns {() => void} */
export function createEditorToolbarEventBinder({
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
    return function bindToolbarEvents() {
        const btnSizeDown = document.getElementById('editor-btn-size-down');
        const btnSizeUp = document.getElementById('editor-btn-size-up');
        const btnTextColor = document.getElementById('editor-btn-text-color');
        const btnBgColor = document.getElementById('editor-btn-bg-color');
        const btnDelete = document.getElementById('editor-btn-delete');
        const btnDuplicate = document.getElementById('editor-btn-duplicate');
        const btnReplaceImg = document.getElementById('editor-btn-replace-img');

        if (btnSizeDown) {
            btnSizeDown.addEventListener('click', e => {
                e.stopPropagation();
                changeFontSize(-2);
            });
        }

        if (btnSizeUp) {
            btnSizeUp.addEventListener('click', e => {
                e.stopPropagation();
                changeFontSize(2);
            });
        }

        if (btnTextColor) {
            btnTextColor.addEventListener('click', e => {
                e.stopPropagation();
                setActiveColorAction('text');
                showColorPicker(e.currentTarget);
            });
        }

        if (btnBgColor) {
            btnBgColor.addEventListener('click', e => {
                e.stopPropagation();
                setActiveColorAction('bg');
                showColorPicker(e.currentTarget);
            });
        }

        if (btnReplaceImg) {
            btnReplaceImg.addEventListener('click', e => {
                e.stopPropagation();
                const selectedElement = getSelectedElement();
                if (selectedElement && window.parent && window.parent._triggerImagePicker) {
                    window.parent._triggerImagePicker(selectedElement);
                }
            });
        }

        if (btnDelete) {
            btnDelete.addEventListener('click', e => {
                e.stopPropagation();
                deleteElement(getSelectedElement());
            });
        }

        if (btnDuplicate) {
            btnDuplicate.addEventListener('click', e => {
                e.stopPropagation();
                const selectedElement = getSelectedElement();
                if (selectedElement) duplicateElement(selectedElement);
            });
        }

        toolbar.querySelectorAll('.editor-color-swatches-mini .editor-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', e => {
                e.stopPropagation();
                const selectedElement = getSelectedElement();
                if (selectedElement) {
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
                    window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element: selectedElement } }));
                }
            });
        });
    };
}
