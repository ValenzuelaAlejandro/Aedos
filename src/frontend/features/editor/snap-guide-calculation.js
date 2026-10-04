/** @typedef {{val: number}} EditorSnapGuideTarget */

/**
 * Finds the first closest guide match within the strict tolerance boundary.
 * Candidate and target order intentionally break equal-distance ties.
 * @param {number[]} candidates
 * @param {EditorSnapGuideTarget[]} targets
 * @param {number} tolerance
 * @returns {{value: number|null, delta: number}}
 */
export function findEditorSnapGuideMatch(candidates, targets, tolerance) {
    let value = null;
    let delta = 0;
    let minDistance = tolerance;
    for (const candidate of candidates) {
        for (const target of targets) {
            const distance = Math.abs(candidate - target.val);
            if (distance < minDistance) {
                minDistance = distance;
                value = target.val;
                delta = target.val - candidate;
            }
        }
    }
    return { value, delta };
}
