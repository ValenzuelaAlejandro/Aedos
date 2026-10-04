import { createEditorSnapTargets } from './snap-targets.js';

/** @typedef {{val: number}} EditorPointerSnapTarget */

/**
 * @typedef {object} AedosPointerSelectionOptions
 * @property {Document} document
 * @property {() => boolean} getIsLocked
 * @property {() => void} ensureUI
 * @property {(element: Element) => boolean} isImageSlotElement
 * @property {(element: Element) => boolean} isTextEditableElement
 * @property {(element: Element) => Element|null} findEditableTarget
 * @property {(element: Element) => Element|null} getStableDragTarget
 * @property {(slide: Element, exclude: Element) => Element[]} getEditableElementsInSlide
 * @property {(element: Element) => void} selectElement
 * @property {() => void} deselectGroup
 * @property {(value: boolean) => void} setIsDragging
 * @property {(elements: Element[]) => void} setDragGroup
 * @property {(element: Element|null) => void} setActiveDragTarget
 * @property {(x: number, y: number) => void} setStartPointer
 * @property {(left: number, top: number) => void} setStartPosition
 * @property {(x: EditorPointerSnapTarget[], y: EditorPointerSnapTarget[]) => void} setSnapLines
 */

/** Creates the existing body pointer-selection/drag-start listener. @param {AedosPointerSelectionOptions} options @returns {(event: MouseEvent) => void} */
export function createEditorPointerSelectionHandler({
    document,
    getIsLocked,
    ensureUI,
    isImageSlotElement,
    isTextEditableElement,
    findEditableTarget,
    getStableDragTarget,
    getEditableElementsInSlide,
    selectElement,
    deselectGroup,
    setIsDragging,
    setDragGroup,
    setActiveDragTarget,
    setStartPointer,
    setStartPosition,
    setSnapLines,
}) {
    return function handleBodyPointerSelection(e) {
        if (getIsLocked()) return;
        ensureUI();

        if (e.target.closest('.editor-selection-box') || e.target.closest('.editor-toolbar') || e.target.closest('.editor-color-picker')) return;
        if (e.target.closest('[contenteditable="true"]')) return;

        const allUnderCursor = document.elementsFromPoint(e.clientX, e.clientY);
        let target = findEditableTarget(e.target);
        if (!isImageSlotElement(target) && !isTextEditableElement(e.target)) {
            for (const el of allUnderCursor) {
                if (el.closest('.editor-selection-box') || el.closest('.editor-toolbar')) continue;
                if (isImageSlotElement(el)) {
                    target = el;
                    break;
                }
            }
        }
        if (!target) {
            for (const el of allUnderCursor) {
                if (el.closest('.editor-selection-box') || el.closest('.editor-toolbar')) continue;
                const match = findEditableTarget(el);
                if (match) {
                    target = match;
                    break;
                }
            }
        }

        if (target) {
            selectElement(target);
            setIsDragging(true);
            setDragGroup([]);
            const activeDragTarget = getStableDragTarget(target);
            setActiveDragTarget(activeDragTarget);

            const rect = activeDragTarget.getBoundingClientRect();
            const slide = activeDragTarget.closest('.s') || activeDragTarget.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();
            setStartPointer(e.clientX, e.clientY);
            setStartPosition(rect.left - slideRect.left, rect.top - slideRect.top);

            const { snapLinesX, snapLinesY } = createEditorSnapTargets(slide, activeDragTarget, getEditableElementsInSlide);
            setSnapLines(snapLinesX, snapLinesY);
            if (e.target.contentEditable !== 'true') e.preventDefault();
        } else {
            deselectGroup();
        }
    };
}
