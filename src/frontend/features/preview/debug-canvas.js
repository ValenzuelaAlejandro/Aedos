(function registerDebugCanvas(global) {
    'use strict';

    /**
     * @typedef {Object} DebugCanvasDependencies
     * @property {Window} window
     * @property {Document} document
     * @property {Function} fetch
     * @property {HTMLElement|null} previewContainer
     * @property {HTMLElement|null} chatScreen
     * @property {HTMLElement|null} errorContainer
     * @property {HTMLElement|null} errorMessage
     * @property {Function} showErrorModal
     * @property {Function} resetUI
     * @property {Function} extractTitle
     * @property {Function} openPreview
     */

    /**
     * Creates localhost-only access to the last generated debug canvas.
     * @param {DebugCanvasDependencies} deps
     * @returns {{initialize: Function}}
     */
    function createDebugCanvas(deps) {
        let debugLastGeneratedBtn = null;

        async function openLastGeneratedDebugCanvas() {
            if (debugLastGeneratedBtn) debugLastGeneratedBtn.disabled = true;

            try {
                const response = await deps.fetch('/__dev__/last-generated', { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error('No debug HTML available in tmp/last_generated.html.');
                }

                const html = await response.text();
                const title = deps.extractTitle(html, 'Debug Canvas');
                deps.openPreview(html, title);
            } catch (error) {
                if (deps.previewContainer) deps.previewContainer.classList.add('hidden');
                if (deps.chatScreen) {
                    deps.chatScreen.style.cssText = '';
                    deps.chatScreen.classList.remove('hidden');
                }
                if (deps.errorMessage) deps.errorMessage.textContent = error.message;
                if (deps.errorContainer) deps.showErrorModal(() => deps.resetUI());
                deps.document.body.classList.remove('no-scroll');
            } finally {
                if (debugLastGeneratedBtn) debugLastGeneratedBtn.disabled = false;
            }
        }

        async function initialize() {
            // Only run on localhost — never inject anything in production.
            const isLocal = deps.window.location.hostname === 'localhost' || deps.window.location.hostname === '127.0.0.1';
            if (!isLocal) return;

            try {
                const response = await deps.fetch('/__dev__/last-generated', { method: 'HEAD', cache: 'no-store' });
                if (!response.ok) return;

                // Create the button dynamically so it never ships in the production HTML.
                debugLastGeneratedBtn = deps.document.createElement('button');
                debugLastGeneratedBtn.type = 'button';
                debugLastGeneratedBtn.id = 'btn-debug-last-generated';
                debugLastGeneratedBtn.className = 'action-icon-btn';
                debugLastGeneratedBtn.title = 'Load last generated HTML (Dev only)';
                debugLastGeneratedBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>`;

                // Insert before the attach-file button.
                const btnAttachFileEl = deps.document.getElementById('btn-attach-file');
                if (btnAttachFileEl) {
                    btnAttachFileEl.parentElement.insertBefore(debugLastGeneratedBtn, btnAttachFileEl);
                }

                debugLastGeneratedBtn.addEventListener('click', () => openLastGeneratedDebugCanvas());

                const params = new URLSearchParams(deps.window.location.search);
                if (params.get('debug') === 'last') {
                    openLastGeneratedDebugCanvas();
                }
            } catch (error) {
                // Endpoint unavailable — silently skip.
            }
        }

        return { initialize };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createDebugCanvas = createDebugCanvas;
})(globalThis);
