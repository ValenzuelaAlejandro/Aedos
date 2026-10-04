/** @typedef {import('./semantics.js').AedosEditorSemanticsApi} AedosEditorSemanticsApi */

/**
 * @typedef {object} AedosEditorTargetingOptions
 * @property {Document} document
 * @property {typeof Element} Element
 * @property {typeof Node} Node
 * @property {AedosEditorSemanticsApi} semantics
 */

/** @typedef {object} AedosEditorTargetingApi
 * @property {(root: Element, excludeEl?: Element|null) => Element[]} getEditableElementsInNode
 * @property {(slide: Element|null, excludeEl?: Element|null) => Element[]} getEditableElementsInSlide
 * @property {(root: Element, excludeEl?: Element|null, includeRoot?: boolean) => Element[]} getTopLevelEditableElements
 * @property {() => Element[]} getAllEditableElements
 * @property {(startEl: Node|Element|null) => Element|null} findEditableTarget
 * @property {(el: Element|null, slide?: Element|null) => Element|null} getStableDragTarget
 */

/** Creates semantic target traversal for the iframe editor. @param {AedosEditorTargetingOptions} options @returns {AedosEditorTargetingApi} */
export function createEditorTargeting({ document, Element, Node, semantics }) {
    const {
        getSlideRoot,
        isIgnoredElement,
        isTextEditableElement,
        isImageSlotElement,
        isVisualLeafElement,
        isSemanticContainer,
        getNearestSemanticContainerAncestor,
        isEditableElement,
    } = semantics;

    function getEditableElementsInNode(root, excludeEl) {
        if (!root || !(root instanceof Element)) return [];

        const hostSlide = getSlideRoot(root);
        const candidates = [root, ...root.querySelectorAll('*')];
        const seen = new Set();

        return candidates.filter(el => {
            if (!(el instanceof Element) || seen.has(el)) return false;
            seen.add(el);

            if (!isEditableElement(el, hostSlide)) return false;
            if (excludeEl && (excludeEl.contains(el) || el.contains(excludeEl))) return false;

            return true;
        });
    }

    function getEditableElementsInSlide(slide, excludeEl) {
        if (!slide) return [];
        return getEditableElementsInNode(slide, excludeEl)
            .filter(element => {
                if (element === excludeEl) return false;
                if (element.style.display === 'none' || element.style.visibility === 'hidden') return false;
                if (isIgnoredElement(element)) return false;
                if (excludeEl && (excludeEl.contains(element) || element.contains(excludeEl))) return false;
                return true;
            });
    }

    function getTopLevelEditableElements(root, excludeEl, includeRoot = false) {
        if (!root || !(root instanceof Element)) return [];

        const hostSlide = getSlideRoot(root);
        return getEditableElementsInNode(root, excludeEl).filter(el => {
            if (!includeRoot && el === root) return false;
            const container = getNearestSemanticContainerAncestor(el, hostSlide);
            return !container || container === root;
        });
    }

    function getAllEditableElements() {
        const slideRoots = Array.from(document.querySelectorAll('section.s, section'));
        const roots = slideRoots.length ? slideRoots : [document.body];
        const seen = new Set();
        const all = [];

        roots.forEach(root => {
            getEditableElementsInNode(root).forEach(el => {
                if (seen.has(el)) return;
                seen.add(el);
                all.push(el);
            });
        });

        return all;
    }

    function findEditableTarget(startEl) {
        const origin = startEl?.nodeType === Node.ELEMENT_NODE ? startEl : startEl?.parentElement;
        if (!origin) return null;

        const slide = getSlideRoot(origin);
        let current = origin;
        let fallback = null;

        while (current && current !== slide && current !== document.body) {
            if (isIgnoredElement(current)) return null;
            if (isTextEditableElement(current) || isImageSlotElement(current) || isVisualLeafElement(current)) {
                return current;
            }
            if (!fallback && isSemanticContainer(current, slide)) {
                fallback = current;
            }
            current = current.parentElement;
        }

        return fallback;
    }

    function getStableDragTarget(el, slide = null) {
        if (!el || !(el instanceof Element)) return el;

        const hostSlide = slide || getSlideRoot(el);
        if (!hostSlide || el.style.position === 'absolute') return el;

        const chain = [];
        let current = isSemanticContainer(el, hostSlide) ? el : getNearestSemanticContainerAncestor(el, hostSlide);

        while (current) {
            chain.push(current);
            current = getNearestSemanticContainerAncestor(current, hostSlide);
        }

        if (!chain.length) return el;

        let stableTarget = chain[0];
        chain.forEach(candidate => {
            const parent = candidate.parentElement;
            if (!parent || parent === hostSlide || !isSemanticContainer(parent, hostSlide)) {
                stableTarget = candidate;
            }
        });

        return stableTarget;
    }

    return {
        getEditableElementsInNode,
        getEditableElementsInSlide,
        getTopLevelEditableElements,
        getAllEditableElements,
        findEditableTarget,
        getStableDragTarget,
    };
}
