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

/** @typedef {object} AedosEditorNormalizeOptions
 * @property {Window} window
 * @property {(callback: () => void, delay: number) => number} setTimeout
 * @property {() => void} saveState
 * @property {(element: Element, slide: Element) => Element|null} getNearestSemanticContainerAncestor
 * @property {(element: Element) => boolean} isTextEditableElement
 * @property {(element: Element, slide: Element) => boolean} isTextContainerElement
 * @property {(element: Element) => boolean} isHeadingLikeElement
 * @property {string} textEditableSelectors
 * @property {(element: Element) => {fontSize: string, fontFamily: string, color: string, lineHeight: string, textAlign: string, fontWeight: string, letterSpacing: string, textTransform: string, fontVariant: string, fontStyle: string, textDecoration: string}} getInheritedStyles
 */

/** Creates the original element-to-slide normalization operation. @param {AedosEditorNormalizeOptions} options @returns {(element: Element, slide: Element, silent?: boolean, rect?: EditorSlideRect|null, force?: boolean) => void} */
export function createEditorElementNormalizer({
    window,
    setTimeout,
    saveState,
    getNearestSemanticContainerAncestor,
    isTextEditableElement,
    isTextContainerElement,
    isHeadingLikeElement,
    textEditableSelectors,
    getInheritedStyles,
}) {
    return function normalizeElement(element, slide, silent = false, providedRect = null, force = false) {
        if (element._normalized) return;

        // Guard: never extract an element from inside a semantic container.
        // If its direct parent is a container (card, stat-box, etc.), marking it
        // normalized without mutations is enough — the container itself will be
        // normalized as a whole and its children stay intact inside it.
        // Pass force=true to bypass this (e.g. when the user explicitly drags a child out).
        if (!force && getNearestSemanticContainerAncestor(element, slide)) {
            element._normalized = true;
            return;
        }

        element._normalized = true;
        if (!silent) saveState();

        const rect = providedRect || element.getBoundingClientRect();
        const slideRect = slide.getBoundingClientRect();
        const inherited = getInheritedStyles(element);
        const style = window.getComputedStyle(element);

        const originalTransition = element.style.transition;
        element.style.transition = 'none';

        if (style.position !== 'absolute') {
            const currentZ = element.style.zIndex;
            if (element.parentElement !== slide) slide.appendChild(element);
            if (currentZ) element.style.zIndex = currentZ;

            const isText = isTextEditableElement(element);
            const isTextContainer = isTextContainerElement(element, slide);
            const isFlexible = isText || isTextContainer;
            const lhPx = parseFloat(inherited.lineHeight) || parseFloat(inherited.fontSize) * 1.2;
            const isHeading = isHeadingLikeElement(element);
            const isSingleLine = isHeading && rect.height <= lhPx * 1.8;

            element.style.boxSizing = 'border-box';
            element.style.position = 'absolute';
            element.style.margin = '0';
            element.style.overflow = isText ? 'visible' : 'hidden';
            element.style.minHeight = '0';
            element.style.minWidth = '0';
            // Add a small buffer to text width to absorb sub-pixel rendering differences
            // after the element is extracted from its original CSS context.
            element.style.width = rect.width + 'px';
            element.style.height = isFlexible ? 'auto' : (rect.height + 'px');
            element.style.minHeight = isFlexible ? (rect.height + 'px') : '0';
            element.style.left = (rect.left - slideRect.left) + 'px';
            element.style.top = (rect.top - slideRect.top) + 'px';
            element.style.transform = 'none';
            if (isSingleLine) element.style.whiteSpace = 'nowrap';
        } else {
            const isText = isTextEditableElement(element);
            const isTextContainer = isTextContainerElement(element, slide);
            const isFlexible = isText || isTextContainer;
            const lhPx = parseFloat(inherited.lineHeight) || parseFloat(inherited.fontSize) * 1.2;
            const isHeading = isHeadingLikeElement(element);
            const isSingleLine = isHeading && rect.height <= lhPx * 1.8;

            element.style.boxSizing = 'border-box';
            element.style.margin = '0';
            element.style.overflow = isText ? 'visible' : 'hidden';
            element.style.minHeight = '0';
            element.style.minWidth = '0';
            // Use a 10px buffer for absolute text to absorb sub-pixel rendering differences
            element.style.width = isText ? (rect.width + 10) + 'px' : rect.width + 'px';
            element.style.height = isFlexible ? 'auto' : (rect.height + 'px');
            element.style.minHeight = isFlexible ? (rect.height + 'px') : '0';
            element.style.left = (rect.left - slideRect.left) + 'px';
            element.style.top = (rect.top - slideRect.top) + 'px';
            element.style.transform = 'none';
            if (isSingleLine) element.style.whiteSpace = 'nowrap';
        }

        if (inherited) {
            element.style.fontSize = inherited.fontSize;
            element.style.fontFamily = inherited.fontFamily;
            element.style.color = inherited.color;
            element.style.lineHeight = inherited.lineHeight;
            element.style.textAlign = inherited.textAlign;
            element.style.fontWeight = inherited.fontWeight;
            element.style.letterSpacing = inherited.letterSpacing;
            element.style.textTransform = inherited.textTransform;
            element.style.fontVariant = inherited.fontVariant;
            element.style.fontStyle = inherited.fontStyle;
            element.style.textDecoration = inherited.textDecoration;
        }

        const textElements = element.querySelectorAll(textEditableSelectors);
        textElements.forEach(item => {
            const comp = window.getComputedStyle(item);
            item.style.fontSize = comp.fontSize;
        });

        setTimeout(() => {
            if (element) element.style.transition = originalTransition;
        }, 50);
    };
}
