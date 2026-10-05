/**
 * @typedef {Object} EditorLockLifecycleDependencies
 * @property {Document} document
 * @property {Window} window
 * @property {Object} pointerState
 * @property {Function} deselectGroup
 */

/** Install the legacy fullscreen lock facade and its four listeners in order. */
export function bindEditorLockLifecycle(deps) {
    const { document, window, pointerState, deselectGroup } = deps;

    window.setLocked = (locked) => {
        pointerState.isLocked = locked;
        if (locked) {
            document.body.classList.add('editor-locked');
            deselectGroup();
            pointerState.isDragging = false;
            pointerState.isResizing = false;
        } else {
            document.body.classList.remove('editor-locked');
        }
    };

    // Auto-lock if parent goes fullscreen.
    const syncLockWithFullscreen = () => {
        const isFS = !!(document.fullscreenElement || window.parent.document.fullscreenElement || document.webkitFullscreenElement || window.parent.document.webkitFullscreenElement);
        window.setLocked(isFS);
    };
    document.addEventListener('fullscreenchange', syncLockWithFullscreen);
    window.parent.document.addEventListener('fullscreenchange', syncLockWithFullscreen);
    document.addEventListener('webkitfullscreenchange', syncLockWithFullscreen);
    window.parent.document.addEventListener('webkitfullscreenchange', syncLockWithFullscreen);
}
