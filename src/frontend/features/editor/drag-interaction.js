import { resolveDragCollision } from './collision-geometry.js';
import { findEditorSnapGuideMatch } from './snap-guide-calculation.js';

/** @typedef {{val: number}} EditorDragSnapTarget */

/** Applies the existing drag collision, snap-guide, and position updates. @param {MouseEvent} event @param {{currentElement: Element, selectedElement: Element|null, slide: Element, startX: number, startY: number, startLeft: number, startTop: number, snapLinesX: EditorDragSnapTarget[], snapLinesY: EditorDragSnapTarget[], guideH: HTMLElement, guideV: HTMLElement, updateSelectionBox: () => void}} state */
export function applyEditorDrag(event, {
    currentElement,
    selectedElement,
    slide,
    startX,
    startY,
    startLeft,
    startTop,
    snapLinesX,
    snapLinesY,
    guideH,
    guideV,
    updateSelectionBox,
}) {
    if (!currentElement._normalized) return;

    let newLeft = startLeft + (event.clientX - startX);
    let newTop = startTop + (event.clientY - startY);
    const eRect = currentElement.getBoundingClientRect();
    const resolved = resolveDragCollision({
        left: newLeft,
        top: newTop,
        width: eRect.width,
        height: eRect.height
    }, slide, selectedElement);
    newLeft = resolved.left;
    newTop = resolved.top;

    if (slide) {
        const sRect = slide.getBoundingClientRect();
        const myLinesX = [newLeft, newLeft + eRect.width / 2, newLeft + eRect.width];
        const myLinesY = [newTop, newTop + eRect.height / 2, newTop + eRect.height];
        const snapTolerance = 8;
        const { value: bestSnapX, delta: bestDiffX } = findEditorSnapGuideMatch(myLinesX, snapLinesX, snapTolerance);
        if (bestSnapX !== null) {
            newLeft += bestDiffX;
            guideV.style.left = (sRect.left + bestSnapX) + 'px';
            guideV.style.top = '0px';
            guideV.style.height = '100%';
            guideV.style.display = 'block';
        } else {
            guideV.style.display = 'none';
        }

        const { value: bestSnapY, delta: bestDiffY } = findEditorSnapGuideMatch(myLinesY, snapLinesY, snapTolerance);
        if (bestSnapY !== null) {
            newTop += bestDiffY;
            guideH.style.top = (sRect.top + bestSnapY) + 'px';
            guideH.style.left = '0px';
            guideH.style.width = '100%';
            guideH.style.display = 'block';
        } else {
            guideH.style.display = 'none';
        }
    }

    currentElement.style.left = `${newLeft}px`;
    currentElement.style.top = `${newTop}px`;
    updateSelectionBox();
}
