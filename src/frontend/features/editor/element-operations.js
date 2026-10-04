/** @typedef {{document: Document, saveState: () => void, freezeSlideLayout: (slide: Element) => void, collectGroup: (element: Element) => Array<{el: Element}>, deselectGroup: () => void, normalizeElement: (element: Element, slide: Element) => void, selectElement: (element: Element) => void}} AedosEditorElementOperationOptions */

/** Creates the existing duplicate/delete operations using explicit editor APIs. @param {AedosEditorElementOperationOptions} options */
export function createEditorElementOperations({ document, saveState, freezeSlideLayout, collectGroup, deselectGroup, normalizeElement, selectElement }) {
    function deleteElement(element) {
        if (!element) return;
        const slide = element.closest('.s') || element.closest('section') || document.body;
        freezeSlideLayout(slide);
        saveState();
        const group = collectGroup(element);
        group.forEach(item => item.el.remove());
        element.remove();
        deselectGroup();
    }

    function duplicateElement(element) {
        saveState();
        const slide = element.closest('.s') || element.closest('section') || document.body;
        normalizeElement(element, slide);
        const group = collectGroup(element);
        const clones = [];
        const mainClone = element.cloneNode(true);
        delete mainClone._stateSavedSinceMousedown;
        clones.push({ original: element, clone: mainClone });
        group.forEach(item => {
            normalizeElement(item.el, slide);
            const childClone = item.el.cloneNode(true);
            delete childClone._stateSavedSinceMousedown;
            clones.push({ original: item.el, clone: childClone });
        });
        clones.forEach(pair => {
            const currentLeft = parseFloat(pair.original.style.left) || 0;
            const currentTop = parseFloat(pair.original.style.top) || 0;
            pair.clone.style.left = (currentLeft + 20) + 'px';
            pair.clone.style.top = (currentTop + 20) + 'px';
            slide.appendChild(pair.clone);
        });
        selectElement(mainClone);
    }

    return { deleteElement, duplicateElement };
}
