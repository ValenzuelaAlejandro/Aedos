(function registerOutsideDeselect(global) {
    'use strict';

    /**
     * @typedef {Object} OutsideDeselectDependencies
     * @property {Document} document Existing parent document.
     * @property {HTMLElement|null} previewContainer Existing preview root.
     * @property {{previewIframe: HTMLIFrameElement|null}} previewState Live preview state.
     */

    /** Register the original click-outside deselection listener. @param {OutsideDeselectDependencies} deps */
    function createOutsideDeselect({ document, previewContainer, previewState }) {
        document.addEventListener('mousedown', (e) => {
            // Only act if preview is visible
            if (previewContainer && !previewContainer.classList.contains('hidden')) {
                // If not clicking inside the iframe itself
                if (e.target !== previewState.previewIframe) {
                    // And not clicking on editor UI elements (tools, minimap, header)
                    const isEditorInteraction =
                        e.target.closest('#editor-tools-panel') ||
                        e.target.closest('#editor-minimap') ||
                        e.target.closest('.preview-unified-header') ||
                        e.target.closest('#floating-toolbar') ||
                        e.target.closest('._slot-overlay-label');

                    if (!isEditorInteraction) {
                        try {
                            if (previewState.previewIframe && previewState.previewIframe.contentWindow && previewState.previewIframe.contentWindow.editorDeselect) {
                                previewState.previewIframe.contentWindow.editorDeselect();
                            }
                        // eslint-disable-next-line no-empty -- Keep iframe access best-effort as before.
                        } catch (err) { }
                    }
                }
            }
        });
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createOutsideDeselect = createOutsideDeselect;
})(window);
