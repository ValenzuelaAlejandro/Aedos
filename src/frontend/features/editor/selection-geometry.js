/**
 * @typedef {{left: number, top: number, width: number, height: number}} EditorRect
 * @typedef {{width: number, height: number}} EditorViewport
 * @typedef {{left: number, top: number, width: number, height: number, toolbarLeft: number, toolbarTop: number, isVisible: boolean, isSmall: boolean}} EditorSelectionGeometry
 */

/**
 * Calculate the clipped selection frame and the legacy toolbar position.
 * @param {EditorRect} rect Selection target's viewport rectangle.
 * @param {EditorViewport} viewport Iframe viewport dimensions.
 * @param {number} toolbarWidth Measured toolbar width (falls back to 340).
 * @returns {EditorSelectionGeometry}
 */
export function calculateEditorSelectionGeometry(rect, viewport, toolbarWidth) {
    const boxLeft = Math.max(0, Math.min(rect.left, viewport.width));
    const boxTop = Math.max(0, Math.min(rect.top, viewport.height));
    const boxRight = Math.max(boxLeft, Math.min(rect.left + rect.width, viewport.width));
    const boxBottom = Math.max(boxTop, Math.min(rect.top + rect.height, viewport.height));
    const boxWidth = boxRight - boxLeft;
    const boxHeight = boxBottom - boxTop;

    const effectiveToolbarWidth = toolbarWidth || 340;
    let toolbarTop = boxTop - 56;
    let toolbarLeft = boxLeft;

    if (toolbarTop < 10) toolbarTop = boxTop + boxHeight + 12;
    if (toolbarTop + 46 > viewport.height - 10) {
        toolbarTop = boxTop - 56;
        if (toolbarTop < 0) toolbarTop = 10;
    }

    if (toolbarLeft + effectiveToolbarWidth > viewport.width - 12) {
        toolbarLeft = viewport.width - effectiveToolbarWidth - 12;
    }
    if (toolbarLeft < 12) toolbarLeft = 12;

    return {
        left: boxLeft,
        top: boxTop,
        width: boxWidth,
        height: boxHeight,
        toolbarLeft,
        toolbarTop,
        isVisible: boxWidth !== 0 && boxHeight !== 0,
        isSmall: boxWidth < 50 || boxHeight < 50,
    };
}
