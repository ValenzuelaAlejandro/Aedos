(function registerOutlineLoadingLegacyBridge(global) {
    'use strict';

    /** @typedef {object} LoadingBridgeDependencies
     * @property {object} state
     * @property {() => Array<object>} getAttachedFiles
     * @property {(files: Array<object>) => void} setAttachedFiles
     * @property {number|undefined} chipsTimeout
     * @property {object} [gsap]
     * @property {object} [thinkingPanel]
     * @property {Function} [escapeHtml]
     * @property {Function} [translate]
     */

    /** Adapts the explicit loading contract to legacy window-shaped APIs.
     * @param {LoadingBridgeDependencies} dependencies
     * @returns {object}
     */
    function createLegacyWindow(dependencies) {
        return {
            outlineEditorState: dependencies.state,
            get _attachedFiles() { return dependencies.getAttachedFiles(); },
            set _attachedFiles(files) { dependencies.setAttachedFiles(files); },
            _chipsRenderTimeout: dependencies.chipsTimeout,
            gsap: dependencies.gsap,
            escapeHtml: dependencies.escapeHtml,
            AedosThinking: dependencies.thinkingPanel,
            __t: dependencies.translate
        };
    }

    global.AedosOutlineLoadingLegacyBridge = Object.freeze({ createLegacyWindow });
})(window);
