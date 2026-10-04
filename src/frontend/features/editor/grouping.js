/** @typedef {{document: Document, isSemanticContainer: (element: Element, slide: Element) => boolean, getEditableElementsInSlide: (slide: Element, exclude: Element) => Element[]}} AedosEditorGroupingOptions */

/** Creates the editor's visual containment grouping calculation. @param {AedosEditorGroupingOptions} options */
export function createEditorGrouping({ document, isSemanticContainer, getEditableElementsInSlide }) {
    return function collectGroup(target) {
        const group = [];
        const slide = target.closest('.s') || target.closest('section') || document.body;
        const isContainer = isSemanticContainer(target, slide);
        if (!isContainer) return group;

        const rect = target.getBoundingClientRect();
        const slideRect = slide.getBoundingClientRect();
        const others = getEditableElementsInSlide(slide, target);
        others.forEach(other => {
            const otherRect = other.getBoundingClientRect();
            if (otherRect.left >= rect.left - 2 &&
                otherRect.right <= rect.right + 2 &&
                otherRect.top >= rect.top - 2 &&
                otherRect.bottom <= rect.bottom + 2) {
                group.push({
                    el: other,
                    startLeft: otherRect.left - slideRect.left,
                    startTop: otherRect.top - slideRect.top
                });
            }
        });
        return group;
    };
}
