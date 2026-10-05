(function registerInitialStreamMarkup(global) {
    'use strict';

    /**
     * @typedef {Object} InitialStreamMarkupDependencies
     * @property {Window} window Existing thinking-panel API.
     * @property {Document} iframeDoc Live preview document.
     * @property {Object} generationState Live generation mode state.
     * @property {Function} setPreviewStreamStatus Accessible status updater.
     * @property {HTMLElement|null} reasoningBody Current AI thinking panel host.
     * @property {string} fontLinks Existing font link markup.
     * @property {string} loadingHtml Existing loading document markup.
     */

    /** Create the original first-chunk iframe bootstrap writer. @param {InitialStreamMarkupDependencies} deps */
    function createInitialStreamMarkup(deps) {
        const { window, iframeDoc, generationState, setPreviewStreamStatus, reasoningBody, fontLinks, loadingHtml } = deps;

        return function writeInitialStreamMarkup() {
            setPreviewStreamStatus(generationState.proModeEnabled ? 'Componiendo slides…' : 'Recibiendo slides…');
            if (window.AedosThinking) window.AedosThinking.collapse(reasoningBody);
            iframeDoc.open();
            const skelStyle = `
                                <style class="skeleton-injector">
                                    html {
                                        overflow: hidden !important;
                                    }
                                    html body {
                                        display: flex !important;
                                        flex-direction: row !important;
                                        width: max-content !important;
                                        height: 100% !important;
                                        margin: 0 !important;
                                        padding: 0 !important;
                                        gap: 0 !important;
                                        will-change: transform;
                                    }
                                    html section.s, html section[class*="slide"] {
                                        flex: 0 0 100vw !important;
                                        width: 100vw !important;
                                        max-width: 100vw !important;
                                        min-width: 100vw !important;
                                        height: 100% !important;
                                        overflow: hidden !important;
                                        box-sizing: border-box !important;
                                        margin: 0 !important;
                                    }
                                    html ::-webkit-scrollbar { display: none !important; }
                                </style>
                                ${fontLinks}
                                ${loadingHtml}
                                <script src="/features/skeleton/skeleton-injector.js"></script>
                                `;
            iframeDoc.write(skelStyle);
        };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createInitialStreamMarkup = createInitialStreamMarkup;
})(window);
