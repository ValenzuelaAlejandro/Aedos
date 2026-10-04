/** @typedef {{document: Document, changeFontSize: (delta: number) => void}} EditorToolbarSizeEventsOptions */

/** Registers the existing toolbar font-size controls when their markup exists.
 * @param {EditorToolbarSizeEventsOptions} options
 */
export function bindEditorToolbarSizeEvents({ document, changeFontSize }) {
    const btnSizeDown = document.getElementById('editor-btn-size-down');
    const btnSizeUp = document.getElementById('editor-btn-size-up');

    if (btnSizeDown) {
        btnSizeDown.addEventListener('click', (e) => {
            e.stopPropagation();
            changeFontSize(-2);
        });
    }

    if (btnSizeUp) {
        btnSizeUp.addEventListener('click', (e) => {
            e.stopPropagation();
            changeFontSize(2);
        });
    }
}
