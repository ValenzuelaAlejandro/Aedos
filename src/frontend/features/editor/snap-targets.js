/** @typedef {{val: number}} EditorSnapTarget */

/**
 * Builds the slide-edge, padding, and peer alignment targets used by drag/resize.
 * The order and values intentionally mirror the iframe editor's legacy targets.
 * @param {Element} slide
 * @param {Element} activeDragTarget
 * @param {(slide: Element, exclude: Element) => Element[]} getEditableElementsInSlide
 * @returns {{snapLinesX: EditorSnapTarget[], snapLinesY: EditorSnapTarget[]}}
 */
export function createEditorSnapTargets(slide, activeDragTarget, getEditableElementsInSlide) {
    const snapLinesX = [];
    const snapLinesY = [];
    if (slide) {
        const sRect = slide.getBoundingClientRect();
        snapLinesX.push({ val: sRect.width / 2 });
        snapLinesX.push({ val: 0 });
        snapLinesX.push({ val: sRect.width });
        snapLinesY.push({ val: sRect.height / 2 });
        snapLinesY.push({ val: 0 });
        snapLinesY.push({ val: sRect.height });

        const padding = 40;
        snapLinesX.push({ val: padding });
        snapLinesX.push({ val: sRect.width - padding });
        snapLinesY.push({ val: padding });
        snapLinesY.push({ val: sRect.height - padding });

        const others = getEditableElementsInSlide(slide, activeDragTarget);
        others.forEach(el => {
            if (el === activeDragTarget || el.classList.contains('editor-phantom')) return;
            const oRect = el.getBoundingClientRect();
            const rL = oRect.left - sRect.left;
            const rT = oRect.top - sRect.top;

            snapLinesX.push({ val: rL });
            snapLinesX.push({ val: rL + oRect.width / 2 });
            snapLinesX.push({ val: rL + oRect.width });

            snapLinesY.push({ val: rT });
            snapLinesY.push({ val: rT + oRect.height / 2 });
            snapLinesY.push({ val: rT + oRect.height });
        });
    }
    return { snapLinesX, snapLinesY };
}
