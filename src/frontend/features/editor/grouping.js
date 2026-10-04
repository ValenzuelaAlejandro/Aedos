/** @typedef {{el: Element, startLeft: number, startTop: number}} EditorGroupItem */

/**
 * @typedef {object} AedosEditorGroupingOptions
 * @property {Document} document
 * @property {(element: Element, slide?: Element|null) => boolean} isSemanticContainer
 * @property {(slide: Element, excludeEl: Element) => Element[]} getEditableElementsInSlide
 */

/** Creates the existing visual-group membership calculation. @param {AedosEditorGroupingOptions} options @returns {(target: Element) => EditorGroupItem[]} */
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
            // Intersection with tolerance
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
