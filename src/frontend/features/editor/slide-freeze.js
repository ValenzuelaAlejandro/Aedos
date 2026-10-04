/** @typedef {{left: number, top: number, width: number, height: number}} EditorSlideRect */

/**
 * @typedef {object} AedosEditorSlideFreezeOptions
 * @property {WeakMap<Element, boolean>} frozenSlides
 * @property {() => void} saveState
 * @property {(slide: Element) => Element[]} getEditableElementsInSlide
 * @property {(slide: Element, excludeEl?: Element, includeRoot?: boolean) => Element[]} getTopLevelEditableElements
 * @property {(element: Element, slide: Element, silent?: boolean, rect?: EditorSlideRect) => void} normalizeElement
 */

/** Creates the existing slide-freeze operation without owning selection state. @param {AedosEditorSlideFreezeOptions} options @returns {(slide: Element|null) => void} */
export function createEditorSlideFreeze({
    frozenSlides,
    saveState,
    getEditableElementsInSlide,
    getTopLevelEditableElements,
    normalizeElement,
}) {
    return function freezeSlideLayout(slide) {
        if (!slide || frozenSlides.has(slide)) return;
        frozenSlides.set(slide, true);

        const allEditables = getEditableElementsInSlide(slide);
        if (allEditables.length === 0) return;

        // Only normalize top-level editables. Elements that live inside a semantic
        // container must NOT be independently normalized: normalizeElement would
        // call slide.appendChild() on them, physically extracting them from their
        // parent and leaving the container empty.
        const topLevel = getTopLevelEditableElements(slide);
        if (topLevel.length === 0) return;

        // Capture all positions FIRST before any element is moved
        const data = topLevel.map(element => ({
            element,
            rect: element.getBoundingClientRect(),
        }));

        // Save state ONCE for the whole batch
        saveState();

        // Normalize all elements using captured positions
        data.forEach(({ element, rect }) => {
            normalizeElement(element, slide, true, rect);
        });
    };
}
