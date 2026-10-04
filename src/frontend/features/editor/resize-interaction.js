import { resolveResizeCollision } from './collision-geometry.js';

/** @typedef {{val: number}} EditorResizeSnapTarget */

/**
 * Applies the editor's existing pointer resize interaction, including collision,
 * snap guides, and final inline styles.
 * @param {MouseEvent} event
 * @param {{selectedElement: Element, slide: Element, startX: number, startY: number, startLeft: number, startTop: number, startWidth: number, startHeight: number, currentHandle: string, snapLinesX: EditorResizeSnapTarget[], snapLinesY: EditorResizeSnapTarget[], guideH: HTMLElement, guideV: HTMLElement, updateSelectionBox: () => void}} state
 */
export function applyEditorResize(event, {
    selectedElement,
    slide,
    startX,
    startY,
    startLeft,
    startTop,
    startWidth,
    startHeight,
    currentHandle,
    snapLinesX,
    snapLinesY,
    guideH,
    guideV,
    updateSelectionBox,
}) {
    if (!selectedElement._normalized) return;

    const dx = (event.clientX - startX);
    const dy = (event.clientY - startY);

    let newWidth = startWidth;
    let newHeight = startHeight;
    let newLeft = startLeft;
    let newTop = startTop;

    if (currentHandle.includes('e')) newWidth = startWidth + dx;
    if (currentHandle.includes('s')) newHeight = startHeight + dy;
    if (currentHandle.includes('w')) {
        newWidth = startWidth - dx;
        newLeft = startLeft + dx;
    }
    if (currentHandle.includes('n')) {
        newHeight = startHeight - dy;
        newTop = startTop + dy;
    }

    const fixedRight = startLeft + startWidth;
    const fixedBottom = startTop + startHeight;
    const resolved = resolveResizeCollision({
        left: newLeft, top: newTop, width: newWidth, height: newHeight
    }, currentHandle, slide, selectedElement, { fixedRight, fixedBottom });

    newLeft = resolved.left;
    newTop = resolved.top;
    newWidth = resolved.width;
    newHeight = resolved.height;

    const sRect = slide.getBoundingClientRect();

    if (slide) {
        const snapTolerance = 8;

        if (currentHandle.includes('w')) {
            let bestSnapX = null, bestDiffX = 0, minDistX = snapTolerance;
            for (let tg of snapLinesX) {
                const dist = Math.abs(newLeft - tg.val);
                if (dist < minDistX) {
                    minDistX = dist;
                    bestSnapX = tg.val;
                    bestDiffX = tg.val - newLeft;
                }
            }
            if (bestSnapX !== null) {
                newLeft += bestDiffX;
                newWidth -= bestDiffX;
                guideV.style.left = (sRect.left + bestSnapX) + 'px';
                guideV.style.top = '0px';
                guideV.style.height = '100%';
                guideV.style.display = 'block';
            } else {
                guideV.style.display = 'none';
            }
        } else if (currentHandle.includes('e')) {
            let rightEdge = newLeft + newWidth;
            let bestSnapX = null, bestDiffX = 0, minDistX = snapTolerance;
            for (let tg of snapLinesX) {
                const dist = Math.abs(rightEdge - tg.val);
                if (dist < minDistX) {
                    minDistX = dist;
                    bestSnapX = tg.val;
                    bestDiffX = tg.val - rightEdge;
                }
            }
            if (bestSnapX !== null) {
                newWidth += bestDiffX;
                guideV.style.left = (sRect.left + bestSnapX) + 'px';
                guideV.style.top = '0px';
                guideV.style.height = '100%';
                guideV.style.display = 'block';
            } else {
                guideV.style.display = 'none';
            }
        }

        if (currentHandle.includes('n')) {
            let bestSnapY = null, bestDiffY = 0, minDistY = snapTolerance;
            for (let tg of snapLinesY) {
                const dist = Math.abs(newTop - tg.val);
                if (dist < minDistY) {
                    minDistY = dist;
                    bestSnapY = tg.val;
                    bestDiffY = tg.val - newTop;
                }
            }
            if (bestSnapY !== null) {
                newTop += bestDiffY;
                newHeight -= bestDiffY;
                guideH.style.top = (sRect.top + bestSnapY) + 'px';
                guideH.style.left = '0px';
                guideH.style.width = '100%';
                guideH.style.display = 'block';
            } else {
                guideH.style.display = 'none';
            }
        } else if (currentHandle.includes('s')) {
            let bottomEdge = newTop + newHeight;
            let bestSnapY = null, bestDiffY = 0, minDistY = snapTolerance;
            for (let tg of snapLinesY) {
                const dist = Math.abs(bottomEdge - tg.val);
                if (dist < minDistY) {
                    minDistY = dist;
                    bestSnapY = tg.val;
                    bestDiffY = tg.val - bottomEdge;
                }
            }
            if (bestSnapY !== null) {
                newHeight += bestDiffY;
                guideH.style.top = (sRect.top + bestSnapY) + 'px';
                guideH.style.left = '0px';
                guideH.style.width = '100%';
                guideH.style.display = 'block';
            } else {
                guideH.style.display = 'none';
            }
        }
    }

    selectedElement.style.minHeight = '0';
    selectedElement.style.minWidth = '0';
    selectedElement.style.overflow = 'hidden';
    selectedElement.style.width = `${newWidth}px`;
    selectedElement.style.height = `${newHeight}px`;
    selectedElement.style.left = `${newLeft}px`;
    selectedElement.style.top = `${newTop}px`;
    updateSelectionBox();
}
