/** @typedef {{left: number, top: number, width: number, height: number}} EditorCollisionRect */
/** @typedef {{fixedRight?: number, fixedBottom?: number}} EditorResizeAnchor */

/** Keeps the current pointer drag position in the slide coordinate space. @param {EditorCollisionRect} proposedRect @param {Element} slide @param {Element|null} excludeEl */
export function resolveDragCollision(proposedRect, slide, excludeEl) {
    return {
        left: proposedRect.left,
        top: proposedRect.top,
    };
}

/** Enforces the editor's 20px minimum size while preserving a fixed resize edge. @param {EditorCollisionRect} proposedRect @param {string} handle @param {Element} slide @param {Element|null} excludeEl @param {EditorResizeAnchor} [fixed] @returns {EditorCollisionRect} */
export function resolveResizeCollision(proposedRect, handle, slide, excludeEl, fixed = {}) {
    const minSize = 20;

    let res = { ...proposedRect };

    // Min size enforcement
    if (res.width < minSize) {
        res.width = minSize;
        if (handle.includes('w') && fixed.fixedRight !== undefined) {
            res.left = fixed.fixedRight - minSize;
        }
    }
    if (res.height < minSize) {
        res.height = minSize;
        if (handle.includes('n') && fixed.fixedBottom !== undefined) {
            res.top = fixed.fixedBottom - minSize;
        }
    }

    return res;
}
