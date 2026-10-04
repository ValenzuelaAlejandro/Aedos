/**
 * @typedef {object} AedosEditorKeyboardOptions
 * @property {Document} document
 * @property {Window} window
 * @property {typeof CustomEvent} CustomEvent
 * @property {(callback: () => void, delay: number) => number} setTimeout
 * @property {() => Element|null} getSelectedElement
 * @property {() => boolean} getIsLocked
 * @property {() => void} undo
 * @property {() => void} redo
 * @property {() => void} saveState
 * @property {(element: Element) => Array<{el: Element}>} collectGroup
 * @property {(element: Element) => object} getInheritedStyles
 * @property {(element: Element) => Element|null} getStableDragTarget
 * @property {(element: Element, slide: Element) => void} normalizeElement
 * @property {(element: Element|null) => void} deleteElement
 * @property {(element: Element) => void} selectElement
 * @property {(element: Element) => void} duplicateElement
 * @property {(key: string, shift: boolean) => void} moveSelectedElementByArrow
 */

/** Creates keyboard shortcuts and the editor's per-iframe copy/paste buffer. @param {AedosEditorKeyboardOptions} options @returns {(event: KeyboardEvent) => void} */
export function createEditorKeyboardHandler({
    document,
    window,
    CustomEvent,
    setTimeout,
    getSelectedElement,
    getIsLocked,
    undo,
    redo,
    saveState,
    collectGroup,
    getInheritedStyles,
    getStableDragTarget,
    normalizeElement,
    deleteElement,
    selectElement,
    duplicateElement,
    moveSelectedElementByArrow,
}) {
    let clipboard = null;

    return function handleKeyboardShortcut(e) {
        const selectedElement = getSelectedElement();
        const isLocked = getIsLocked();

        // Support arrow navigation even when locked (for presentation mode)
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isEditingText = activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable);

            if (!isEditingText && (!selectedElement || isLocked)) {
                if (e.key === 'ArrowLeft') {
                    window.dispatchEvent(new CustomEvent('navigate-prev'));
                } else {
                    window.dispatchEvent(new CustomEvent('navigate-next'));
                }
                e.preventDefault();
                return;
            }
        }

        if (isLocked) return;
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isEditingText = activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable);

        if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'z') {
                if (e.shiftKey) redo();
                else undo();
                e.preventDefault();
            } else if (e.key.toLowerCase() === 'y') {
                redo();
                e.preventDefault();
            } else if (e.key.toLowerCase() === 'c' && !isEditingText) {
                if (selectedElement) {
                    const slide = selectedElement.closest('.s') || selectedElement.closest('section') || document.body;

                    // Clone the live element without normalizing or moving the original.
                    function cloneForClipboard(element) {
                        if (element._normalized) return element.cloneNode(true);
                        const elRect = element.getBoundingClientRect();
                        const slideRect = slide.getBoundingClientRect();
                        const inherited = getInheritedStyles(element);
                        const clone = element.cloneNode(true);
                        clone.style.boxSizing = 'border-box';
                        clone.style.position = 'absolute';
                        clone.style.margin = '0';
                        clone.style.transform = 'none';
                        clone.style.left = (elRect.left - slideRect.left) + 'px';
                        clone.style.top = (elRect.top - slideRect.top) + 'px';
                        clone.style.width = elRect.width + 'px';
                        clone.style.height = elRect.height + 'px';
                        clone.style.fontSize = inherited.fontSize;
                        clone.style.fontFamily = inherited.fontFamily;
                        clone.style.color = inherited.color;
                        clone.style.lineHeight = inherited.lineHeight;
                        clone._normalized = true;
                        return clone;
                    }

                    const group = collectGroup(selectedElement);
                    clipboard = [cloneForClipboard(selectedElement)];
                    group.forEach(item => clipboard.push(cloneForClipboard(item.el)));
                    selectedElement.style.outline = '2px solid rgba(255,255,255,0.6)';
                    setTimeout(() => {
                        const currentSelection = getSelectedElement();
                        if (currentSelection) currentSelection.style.outline = '';
                    }, 300);
                    e.preventDefault();
                }
            } else if (e.key.toLowerCase() === 'x' && !isEditingText) {
                if (selectedElement) {
                    const isInsideImgSlot = selectedElement.matches('.img-slot, [data-image-slot]') || selectedElement.closest('.img-slot, [data-image-slot]');
                    const target = isInsideImgSlot ? getStableDragTarget(selectedElement) : selectedElement;
                    const slide = target.closest('.s') || target.closest('section') || document.body;
                    normalizeElement(target, slide);

                    const group = collectGroup(target);
                    clipboard = [target.cloneNode(true)];
                    group.forEach(item => {
                        normalizeElement(item.el, slide);
                        clipboard.push(item.el.cloneNode(true));
                        item.el.remove();
                    });

                    deleteElement(target);
                    e.preventDefault();
                }
            } else if (e.key.toLowerCase() === 'v' && !isEditingText) {
                if (clipboard && clipboard.length > 0) {
                    saveState();
                    const activeSlide = document.querySelector('section.active') || document.querySelector('section') || document.body;
                    let mainClone = null;
                    clipboard.forEach((node, idx) => {
                        const clone = node.cloneNode(true);
                        const curLeft = parseFloat(clone.style.left) || 0;
                        const curTop = parseFloat(clone.style.top) || 0;
                        clone.style.left = (curLeft + 20) + 'px';
                        clone.style.top = (curTop + 20) + 'px';
                        activeSlide.appendChild(clone);
                        if (idx === 0) mainClone = clone;
                    });
                    if (mainClone) selectElement(mainClone);
                    e.preventDefault();
                }
            } else if (e.key.toLowerCase() === 'd') {
                e.preventDefault();
                if (isEditingText) return;
                if (selectedElement) duplicateElement(selectedElement);
                else window.dispatchEvent(new CustomEvent('duplicate-slide'));
            }
        } else if (!isEditingText) {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedElement) {
                    deleteElement(selectedElement);
                    e.preventDefault();
                }
            } else if (e.key.startsWith('Arrow')) {
                if (selectedElement) {
                    e.preventDefault();
                    moveSelectedElementByArrow(e.key, e.shiftKey);
                }
            }
        }
    };
}
