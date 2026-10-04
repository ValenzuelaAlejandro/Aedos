/** @typedef {{snapLinesX: Array<{val: number}>, snapLinesY: Array<{val: number}>}} EditorPointerState */

/** Calculate and store the existing snap guides for a pointer drag target. @param {Element} slide @param {Element} dragTarget @param {EditorPointerState} pointerState @param {(slide: Element, target: Element, getEditableElements: Function) => {snapLinesX: Array<{val: number}>, snapLinesY: Array<{val: number}>}} createSnapTargets @param {Function} getEditableElementsInSlide */
export function initializePointerSnapGuides(slide, dragTarget, pointerState, createSnapTargets, getEditableElementsInSlide) {
    const snapTargets = createSnapTargets(slide, dragTarget, getEditableElementsInSlide);
    pointerState.snapLinesX = snapTargets.snapLinesX;
    pointerState.snapLinesY = snapTargets.snapLinesY;
}
