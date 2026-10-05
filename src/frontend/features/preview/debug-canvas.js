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
     * @property {Object} previewState
     * @property {Function} getPreviewUiState
     * @property {Function} removePreviewResizeListener
     * @property {Function} resetOverlayState
     * @property {HTMLElement|null} resultContainer
     * @property {HTMLElement|null} refusedContainer
     * @property {HTMLElement|null} previewHeader
     * @property {HTMLElement|null} slideLabel
     * @property {Function} resetPreviewSurface
     * @property {Function} updateZoomDisplay
     * @property {Function} updateMinimapSkeleton
     * @property {Function} initPreview
     * @property {Function} getScaleIframe
     * @property {Function} clearPendingTransition
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

    /**
     * Creates the existing debug-mode preview flow using live application callbacks.
     * @param {DebugCanvasDependencies} deps
     * @returns {(html: string, title: string) => void}
     */
    function createExistingHtmlPreview(deps) {
        function resetPreviewSurface() {
            deps.removePreviewResizeListener();
            const previewUiState = deps.getPreviewUiState();
            previewUiState.minimapAlreadyInit = false;
            previewUiState.toolsAlreadyInit = false;
            const rawIframe = deps.previewState.previewIframe.cloneNode();
            deps.previewState.previewIframe.parentNode.replaceChild(rawIframe, deps.previewState.previewIframe);
            deps.previewState.previewIframe = rawIframe;

            const minimapList = deps.document.getElementById('minimap-list');
            if (minimapList) {
                minimapList.innerHTML = '';
                minimapList.style.transform = 'none';
                const mmContainer = deps.document.getElementById('editor-minimap');
                if (mmContainer) {
                    mmContainer.style.removeProperty('--presentation-accent');
                    mmContainer.style.removeProperty('--accent');
                }
            }

            if (deps.slideDots) deps.slideDots.innerHTML = '';
            deps.previewState.slideContainer = null;
            deps.resetOverlayState();
        }

        function setPreviewTitle(title) {
            const previewLabel = deps.document.getElementById('preview-topic-label');
            if (!previewLabel) return;

            if (previewLabel.tagName === 'INPUT') previewLabel.value = title;
            else previewLabel.textContent = title;
        }

        return function openPreviewFromExistingHtml(html, title) {
            if (!html || typeof html !== 'string') {
                throw new Error('Debug HTML is empty or invalid.');
            }

            // Set the hash to #editor so back button and warnings work flawlessly in debug mode.
            if (deps.window.location.hash !== '#editor') {
                deps.window.navigateToEditor();
            }

            deps.previewState.generatedHtml = html;
            deps.previewState.currentSlide = 0;
            deps.previewState.totalSlides = 0;
            deps.window.currentSlide = 0;
            deps.previewState.currentTitle = title;
            deps.clearPendingTransition();
            deps.window._manualZoomScale = 1;
            deps.updateZoomDisplay();

            if (deps.resultContainer) deps.resultContainer.classList.add('hidden');
            if (deps.errorContainer) deps.errorContainer.classList.add('hidden');
            if (deps.refusedContainer) deps.refusedContainer.classList.add('hidden');

            deps.previewContainer.classList.remove('hidden', 'is-generating', 'is-settling', 'is-editor-ready', 'reveal-sequence', 'reveal-minimap', 'reveal-tools', 'reveal-chrome');
            deps.chatScreen.style.cssText = '';
            deps.chatScreen.classList.add('hidden');
            deps.document.body.classList.add('no-scroll');

            resetPreviewSurface();
            setPreviewTitle(title);

            deps.slideLabel.textContent = '1 / 1';
            deps.updateMinimapSkeleton(1);

            deps.previewHeader.classList.remove('slide-down');
            deps.initPreview(html, () => {
                deps.previewContainer.classList.remove('is-generating', 'is-settling', 'is-editor-ready', 'reveal-sequence', 'reveal-minimap', 'reveal-tools');
                deps.previewHeader.classList.add('slide-down');
                // Apply settled insets so the slide centers between panels in debug mode.
                if (deps.window.innerWidth > 768) {
                    deps.previewState.editorInsets = { left: 165, right: 30, top: 64, bottom: 64 };
                    const dbgStage = deps.document.getElementById('preview-stage');
                    if (dbgStage) {
                        dbgStage.style.paddingLeft = '165px';
                        dbgStage.style.paddingRight = '30px';
                        dbgStage.style.paddingTop = '64px';
                        dbgStage.style.paddingBottom = '64px';
                    }
                }
                deps.previewContainer.classList.add('is-editor-ready');
                deps.getScaleIframe()();
            });
        };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createDebugCanvas = createDebugCanvas;
    global.AedosPreview.createExistingHtmlPreview = createExistingHtmlPreview;
})(globalThis);
