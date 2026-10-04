/**
 * @typedef {object} AedosEditorPasteOptions
 * @property {Document} document
 * @property {Window} window
 */

/** Creates the plain-text paste handler used inside contenteditable targets. @param {AedosEditorPasteOptions} options @returns {(event: ClipboardEvent) => void} */
export function createEditorPasteHandler({ document, window }) {
    return function handleEditorPaste(e) {
        const target = e.target.closest('[contenteditable="true"]');
        if (!target) return;

        e.preventDefault();
        const clipboardData = e.clipboardData || window.clipboardData;
        const text = clipboardData.getData('text/plain') || clipboardData.getData('text');

        if (text) {
            try {
                document.execCommand('insertText', false, text);
            } catch (err) {
                const selection = window.getSelection();
                if (selection.rangeCount) {
                    const range = selection.getRangeAt(0);
                    range.deleteContents();
                    range.insertNode(document.createTextNode(text));
                    range.collapse(false);
                }
            }
        }
    };
}

/**
 * @typedef {object} AedosEditorTextEditingOptions
 * @property {Document} document
 * @property {Window} window
 * @property {typeof CustomEvent} CustomEvent
 * @property {Element} selectionBox
 * @property {() => Element|null} getSelectedElement
 * @property {() => boolean} getIsLocked
 * @property {(element: Element) => boolean} isTextEditableElement
 * @property {(element: Element, slide: Element) => void} normalizeElement
 * @property {string} textEditableSelectors
 * @property {() => void} saveState
 * @property {(element: Element|null) => void} selectElement
 */

/** Creates the existing double-click-to-edit handler for selected slide content. @param {AedosEditorTextEditingOptions} options @returns {(event: MouseEvent) => void} */
export function createEditorTextEditingHandler({
    document,
    window,
    CustomEvent,
    selectionBox,
    getSelectedElement,
    getIsLocked,
    isTextEditableElement,
    normalizeElement,
    textEditableSelectors,
    saveState,
    selectElement,
}) {
    return function handleSelectedContentDoubleClick(e) {
        if (getIsLocked()) return;
        e.stopPropagation();
        const selectedElement = getSelectedElement();
        if (!selectedElement) return;

        if (selectedElement.dataset.imageSlot !== undefined) {
            if (window.parent && window.parent._triggerImagePicker) {
                window.parent._triggerImagePicker(selectedElement);
            } else {
                document.dispatchEvent(new CustomEvent('trigger-image-picker', {
                    detail: { element: selectedElement },
                    bubbles: true,
                }));
            }
            return;
        }

        const isEditable = element => isTextEditableElement(element);
        const textTarget = isEditable(selectedElement) ? selectedElement : selectedElement.querySelector(textEditableSelectors);

        if (textTarget && !textTarget.closest('.editor-toolbar')) {
            if (!textTarget._normalized) {
                const slide = textTarget.closest('.s') || textTarget.closest('section') || document.body;
                normalizeElement(textTarget, slide);
            }

            const isAbsoluteEl = textTarget.style.position === 'absolute';
            textTarget.contentEditable = 'true';
            textTarget.style.outline = 'none';
            textTarget.style.boxShadow = 'none';
            if (isAbsoluteEl) {
                textTarget.style.height = 'auto';
                textTarget.style.overflow = 'visible';
            }
            textTarget.focus();

            if (isAbsoluteEl) {
                const rect = textTarget.getBoundingClientRect();
                const slide = textTarget.closest('.s') || document.body;
                const slideRect = slide.getBoundingClientRect();
                textTarget._baseBottom = rect.bottom - slideRect.top;
            }

            selectionBox.style.pointerEvents = 'none';
            selectionBox.classList.add('editor-editing-text');
            const range = document.createRange();
            range.selectNodeContents(textTarget);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);

            textTarget.addEventListener('blur', function onBlur() {
                textTarget.contentEditable = 'false';
                textTarget.style.outline = '';
                if (textTarget.style.position === 'absolute') {
                    const newHeight = textTarget.getBoundingClientRect().height;
                    textTarget.style.height = newHeight + 'px';
                }
                delete textTarget._baseBottom;
                textTarget.removeEventListener('blur', onBlur);
                window.getSelection().removeAllRanges();

                selectionBox.style.pointerEvents = 'auto';
                selectionBox.classList.remove('editor-editing-text');
                saveState();
                selectElement(getSelectedElement());
            }, { once: true });
        }
    };
}
