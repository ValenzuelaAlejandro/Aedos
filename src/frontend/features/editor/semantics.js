/**
 * Editor target classification shared within the presentation iframe.
 * Selectors and predicates are moved from `editor.js` without changing their
 * matching rules so editing, grouping, and transforms share the same targets.
 *
 * @typedef {object} AedosEditorSemanticsApi
 * @property {string} editableSelectors
 * @property {string} textEditableSelectors
 * @property {string} ignoreSelectors
 * @property {(node: Element|null|undefined) => Element} getSlideRoot
 * @property {(element: Element|null) => boolean} isIgnoredElement
 * @property {(element: Element|null) => boolean} isTextEditableElement
 * @property {(element: Element|null) => boolean} isHeadingLikeElement
 * @property {(element: Element, slide?: Element|null) => boolean} isTextContainerElement
 * @property {(element: Element|null) => boolean} isImageSlotElement
 * @property {(element: Element|null) => boolean} isVisualLeafElement
 * @property {(element: Element, slide?: Element|null) => boolean} isSemanticContainer
 * @property {(element: Element, slide?: Element|null) => Element|null} getNearestSemanticContainerAncestor
 * @property {(element: Element, slide?: Element|null) => boolean} isEditableElement
 */

/**
 * One cohesive iframe module; the returned API is intentionally small while
 * the dependent classifier predicates remain private to this closure.
 *
 * @returns {AedosEditorSemanticsApi}
 */
// eslint-disable-next-line max-lines-per-function
export function createAedosEditorSemantics() {
    const TEXT_EDITABLE_SELECTORS = 'h1, h2, h3, h4, p, li, blockquote, .tag, .subtitle, cite, [class*="title"], [class*="desc"], [class*="stat"], [class*="label"], [class*="val"], [class*="num"], [class*="caption"], [class*="source"], [class*="cite"], [class*="footnote"], [class*="meta"], .code-line';
    const LEAF_VISUAL_SELECTORS = '.lucide-icon, svg[data-lucide], .accent-bar, img';
    const KNOWN_CONTAINER_SELECTORS = 'div.card, div.stat-box, div.step-item, div.timeline-item, .img-slot, [data-image-slot], .quote-block, ul, ol, [class*="card"], [class*="box"], [class*="item"]';
    const editableSelectors = `${TEXT_EDITABLE_SELECTORS}, ${LEAF_VISUAL_SELECTORS}, .img-slot, [data-image-slot], .quote-block, .card, .stat-box, .step-item, .timeline-item, .flex-row, .flex-col, .grid-2, .grid-3, [class*="card"], [class*="box"], [class*="item"], [data-container="true"]`;
    const ignoreSelectors = '.img-replace-overlay, .img-replace-overlay *, .editor-selection-box, .editor-toolbar, .editor-guide, .editor-phantom';
    const TEXT_EDITABLE_TAGS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, cite, .tag, .subtitle, .code-line';
    const HEADING_LIKE_TAGS = 'h1, h2, h3, h4, .tag';

    function getSlideRoot(node) {
        return node?.closest('.s') || node?.closest('section') || document.body;
    }

    function isIgnoredElement(el) {
        return !!(el && (el.matches(ignoreSelectors) || el.closest(ignoreSelectors)));
    }

    function isTransparentColor(value) {
        if (!value) return true;
        const normalized = value.replace(/\s+/g, '').toLowerCase();
        return normalized === 'transparent' || normalized === 'rgba(0,0,0,0)' || normalized === 'hsla(0,0%,0%,0)';
    }

    function hasDirectTextNodes(el) {
        if (!el || !el.childNodes) return false;
        // Optimization: skip elements with children that are also blocks,
        // to avoid double-detection of containers as text.
        const hasBlockChildren = Array.from(el.children).some(child => {
            const display = window.getComputedStyle(child).display;
            return !display.includes('inline');
        });
        if (hasBlockChildren) return false;

        return Array.from(el.childNodes).some(node =>
            node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim().length > 0
        );
    }

    function isTextEditableElement(el) {
        if (!el || !(el instanceof Element)) return false;

        // CRITICAL: Never normalize INLINE elements (spans, links, bold) individually.
        // Doing so rips them out of their parent block and collapses the layout.
        const style = window.getComputedStyle(el);
        if (style.display.includes('inline') && !style.display.includes('block')) {
            return false;
        }

        if (el.matches(TEXT_EDITABLE_TAGS)) return true;

        // Auto-detect ANY element that is a terminal leaf for text.
        return hasDirectTextNodes(el);
    }

    function isHeadingLikeElement(el) {
        if (!el || !(el instanceof Element)) return false;
        if (el.matches(HEADING_LIKE_TAGS)) return true;

        // If it's a direct text container with big font, treat as heading for UI normalization
        if (hasDirectTextNodes(el)) {
            const fs = parseFloat(window.getComputedStyle(el).fontSize);
            return fs >= 24; // 1.5rem approx
        }
        return false;
    }

    function hasVisibleBackground(style) {
        return style.backgroundImage !== 'none' || !isTransparentColor(style.backgroundColor);
    }

    function hasVisibleBorder(style) {
        const sides = ['Top', 'Right', 'Bottom', 'Left'];
        return sides.some(side => {
            const width = parseFloat(style[`border${side}Width`]) || 0;
            return width > 0 && style[`border${side}Style`] !== 'none' && !isTransparentColor(style[`border${side}Color`]);
        });
    }

    function hasMeaningfulInlineText(el) {
        return Array.from(el.childNodes || []).some(node => (
            node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim().length > 0
        ));
    }

    function isVisualLeafElement(el) {
        if (!el || !(el instanceof Element)) return false;
        if (el.matches(LEAF_VISUAL_SELECTORS) || el.tagName.toLowerCase() === 'img') return true;

        // Auto-detect dynamic CSS shapes generated by the 3-stage LLM (bullets, horizontal lines, badges).
        const style = window.getComputedStyle(el);
        const hasBgOrBorder = hasVisibleBackground(style) || hasVisibleBorder(style);

        // An element is a graphic shape if it is completely empty of text/children, but visually painted.
        if (hasBgOrBorder && el.children.length === 0 && !hasMeaningfulInlineText(el)) {
            // Ignore large atmospheric or background overlays
            if (style.pointerEvents === 'none' && style.position === 'absolute') return false;
            return true;
        }

        return false;
    }

    function isImageSlotElement(el) {
        return !!(el && el.matches('.img-slot, [data-image-slot]'));
    }

    function markSemanticContainer(el, isContainer) {
        if (!el || !el.dataset) return;
        if (isContainer) el.dataset.container = 'true';
        else delete el.dataset.container;
    }

    // Preserve the audited legacy classifier as one decision tree.
    // eslint-disable-next-line complexity
    function isSemanticContainer(el, slide = null) {
        if (!el || !(el instanceof Element)) return false;

        const hostSlide = slide || getSlideRoot(el);
        if (!hostSlide || el === hostSlide || el === document.body || el === document.documentElement) {
            return false;
        }

        if (isIgnoredElement(el)) return false;
        if (isTextEditableElement(el) || isVisualLeafElement(el)) {
            markSemanticContainer(el, false);
            return false;
        }
        if (isImageSlotElement(el) || el.matches(KNOWN_CONTAINER_SELECTORS)) {
            markSemanticContainer(el, true);
            return true;
        }

        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') {
            markSemanticContainer(el, false);
            return false;
        }

        const hasDescendantText = hasMeaningfulInlineText(el) || !!el.querySelector(TEXT_EDITABLE_SELECTORS);
        const hasDescendantSlot = !!el.querySelector('.img-slot, [data-image-slot]');
        const hasStructuredChildren = el.children.length > 1;
        const isLayoutWrapper = ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(style.display);
        const isDecorated = hasVisibleBackground(style) || hasVisibleBorder(style);
        const isTinyUtility = rect.width <= 72 && rect.height <= 72 && !hasDescendantText && !hasDescendantSlot;
        const isDivider = (rect.width <= 10 || rect.height <= 10) && !hasDescendantText && !hasDescendantSlot;
        const isOverlay = style.pointerEvents === 'none' && style.position === 'absolute' && !hasDescendantText && !hasDescendantSlot;

        const isContainer = !isTinyUtility
            && !isDivider
            && !isOverlay
            && (hasDescendantText || hasDescendantSlot || hasStructuredChildren)
            && (isDecorated || (hasStructuredChildren && !isLayoutWrapper));

        markSemanticContainer(el, isContainer);
        return isContainer;
    }

    function getNearestSemanticContainerAncestor(el, slide = null) {
        const hostSlide = slide || getSlideRoot(el);
        let current = el?.parentElement;

        while (current && current !== hostSlide && current !== document.body) {
            if (isSemanticContainer(current, hostSlide)) return current;
            current = current.parentElement;
        }

        return null;
    }

    function isTextContainerElement(el, slide = null) {
        return isSemanticContainer(el, slide) && (hasMeaningfulInlineText(el) || !!el.querySelector(TEXT_EDITABLE_SELECTORS));
    }

    function isEditableElement(el, slide = null) {
        if (!el || !(el instanceof Element)) return false;
        if (isIgnoredElement(el)) return false;

        const hostSlide = slide || getSlideRoot(el);
        const style = window.getComputedStyle(el);
        if (!hostSlide || style.display === 'none' || style.visibility === 'hidden') return false;

        if (isTextEditableElement(el) || isImageSlotElement(el) || isVisualLeafElement(el)) return true;

        return isSemanticContainer(el, hostSlide);
    }

    return {
        editableSelectors,
        textEditableSelectors: TEXT_EDITABLE_SELECTORS,
        ignoreSelectors,
        getSlideRoot,
        isIgnoredElement,
        isTextEditableElement,
        isHeadingLikeElement,
        isTextContainerElement,
        isImageSlotElement,
        isVisualLeafElement,
        isSemanticContainer,
        getNearestSemanticContainerAncestor,
        isEditableElement,
    };
}
