/**
 * Mutable state shared by editor pointer interactions and their adapters.
 *
 * @typedef {Object} EditorPointerState
 * @property {Element|null} selectedElement Current editor selection.
 * @property {boolean} isDragging Whether a pointer drag is active.
 * @property {boolean} isResizing Whether a pointer resize is active.
 * @property {number} startX Pointer x-coordinate at the interaction start.
 * @property {number} startY Pointer y-coordinate at the interaction start.
 * @property {number} startLeft Element left coordinate at the interaction start.
 * @property {number} startTop Element top coordinate at the interaction start.
 * @property {boolean} justSelected Whether selection was just changed.
 * @property {number} startWidth Element width at the interaction start.
 * @property {number} startHeight Element height at the interaction start.
 * @property {string|null} currentHandle Active resize handle identifier.
 * @property {number[]} snapLinesX Horizontal snap guide coordinates.
 * @property {number[]} snapLinesY Vertical snap guide coordinates.
 * @property {Element|null} activeDragTarget Element currently used as drag target.
 * @property {Element[]} dragGroup Elements participating in the current drag.
 * @property {boolean} isLocked Whether editor interaction is locked.
 * @property {boolean} isRestoring Whether history restoration is in progress.
 */

/** Create the state container shared by editor pointer behavior and adapters. */
export function createEditorPointerState() {
    /** @type {EditorPointerState} */
    return {
        selectedElement: null,
        isDragging: false,
        isResizing: false,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        justSelected: false,
        startWidth: 0,
        startHeight: 0,
        currentHandle: null,
        snapLinesX: [],
        snapLinesY: [],
        activeDragTarget: null,
        dragGroup: [],
        isLocked: false,
        isRestoring: false,
    };
}
