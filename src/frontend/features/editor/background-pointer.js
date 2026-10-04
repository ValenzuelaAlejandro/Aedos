/** @typedef {object} EditorBackgroundPointerOptions
 * @property {Document} document
 * @property {() => boolean} getIsLocked
 * @property {() => void} ensureUI
 * @property {(target: Element) => Element|null} findEditableTarget
 * @property {(target: Element|null) => boolean} isImageSlotElement
 * @property {(target: Element) => boolean} isTextEditableElement
 * @property {(target: Element) => void} selectElement
 * @property {() => void} deselect
 * @property {(target: Element) => Element} getStableDragTarget
 * @property {(slide: Element, target: Element, getEditables: Function) => {snapLinesX: number[], snapLinesY: number[]}} createSnapTargets
 * @property {(slide: Element, exclude: Element) => Element[]} getEditableElementsInSlide
 * @property {(value: boolean) => void} setIsDragging
 * @property {(value: Element[]) => void} setDragGroup
 * @property {(value: Element|null) => void} setActiveDragTarget
 * @property {(value: number) => void} setStartX
 * @property {(value: number) => void} setStartY
 * @property {(value: number) => void} setStartLeft
 * @property {(value: number) => void} setStartTop
 * @property {(value: number[]) => void} setSnapLinesX
 * @property {(value: number[]) => void} setSnapLinesY
 */

/** Installs the legacy background hit-testing and pointer-selection handler. @param {EditorBackgroundPointerOptions} options */
export function installEditorBackgroundPointerHandler({
    document,
    getIsLocked,
    ensureUI,
    findEditableTarget,
    isImageSlotElement,
    isTextEditableElement,
    selectElement,
    deselect,
    getStableDragTarget,
    createSnapTargets,
    getEditableElementsInSlide,
    setIsDragging,
    setDragGroup,
    setActiveDragTarget,
    setStartX,
    setStartY,
    setStartLeft,
    setStartTop,
    setSnapLinesX,
    setSnapLinesY,
}) {
    document.body.addEventListener('mousedown', e => {
        if (getIsLocked()) return;
        ensureUI();

        if (e.target.closest('.editor-selection-box') || e.target.closest('.editor-toolbar') || e.target.closest('.editor-color-picker')) {
            return;
        }

        if (e.target.closest('[contenteditable="true"]')) {
            return;
        }

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
            const dragTarget = getStableDragTarget(target);
            setDragGroup([]);
            setActiveDragTarget(dragTarget);
            const rect = dragTarget.getBoundingClientRect();
            const slide = dragTarget.closest('.s') || dragTarget.closest('section') || document.body;
            const slideRect = slide.getBoundingClientRect();

            setStartX(e.clientX);
            setStartY(e.clientY);
            setStartLeft(rect.left - slideRect.left);
            setStartTop(rect.top - slideRect.top);

            const snapTargets = createSnapTargets(slide, dragTarget, getEditableElementsInSlide);
            setSnapLinesX(snapTargets.snapLinesX);
            setSnapLinesY(snapTargets.snapLinesY);

            if (e.target.contentEditable !== 'true') {
                e.preventDefault();
            }
        } else {
            deselect();
        }
    });
}
