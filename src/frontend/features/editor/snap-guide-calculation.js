/** @typedef {{val: number}} EditorSnapGuideTarget */
/** @typedef {{value: number|null, delta: number}} EditorSnapGuideMatch */

/**
 * Finds the first closest guide within the editor's existing snap tolerance.
 * Candidate and target iteration order, strict threshold, and tie handling
 * intentionally match the legacy drag/resize loops.
 * @param {number[]} positions
 * @param {EditorSnapGuideTarget[]} targets
 * @param {number} tolerance
 * @returns {EditorSnapGuideMatch}
 */
export function findEditorSnapGuideMatch(positions, targets, tolerance) {
    let value = null;
    let delta = 0;
    let minimumDistance = tolerance;

    for (const position of positions) {
        for (const target of targets) {
            const distance = Math.abs(position - target.val);
            if (distance < minimumDistance) {
                minimumDistance = distance;
                value = target.val;
                delta = target.val - position;
            }
        }
    }

    return { value, delta };
}
