(function registerFinalGenerationSetup(global) {
    'use strict';

    /**
     * @typedef {Object} FinalGenerationSetupDependencies
     * @property {Window} window Existing global and transition APIs.
     * @property {Document} document Parent document.
     * @property {Object} generationState Live generation store.
     * @property {Object} previewState Live preview store.
     * @property {Object} previewUiState Existing preview UI flags.
     * @property {HTMLElement} previewContainer Preview root.
     * @property {HTMLElement|null} previewHeader Preview header.
     * @property {HTMLElement} chatScreen Chat root.
     * @property {HTMLElement} slideDots Slide dot host.
     * @property {HTMLElement} slideLabel Slide counter.
     * @property {Function} clearPendingTransition Existing transition reset.
     * @property {Function} scaleIframe Existing iframe scaler.
     */

    /** Prepare the original live preview before starting the network request. @param {FinalGenerationSetupDependencies} deps */
    // eslint-disable-next-line max-lines-per-function, complexity -- Keep initial preview setup in its original order.
    function createFinalGenerationSetup(deps) {
        const { window, document, generationState, previewState, previewUiState,
            previewContainer, previewHeader, chatScreen, slideDots, slideLabel,
            clearPendingTransition, scaleIframe,
            stopBtnMessages, resetMobileZoomState, updateZoomDisplay,
            clearStageInlinePadding, setPreviewStreamStatus, updateMinimapSkeleton,
            requestAnimationFrame, setTimeout, clearTimeout } = deps;
        // Enter the live preview immediately. The server emits real SSE progress
        // before its first HTML chunk (especially in Pro mode), so waiting for
        // parsed.chunk makes the UI look frozen during the pipeline stages.
        const generation = {
            id: ++generationState.sequence,
            finalPreviewMounted: false,
            transitionStarted: false
        };
        generationState.activeGeneration = generation;
        clearPendingTransition();

        previewState.generatedHtml = ''; // Reset state for a fresh start
        previewState.currentSlide = 0;
        previewState.totalSlides = 0;

        // Keep the send button in the generation (stop-icon) state during the final HTML
        // generation, regardless of whether we got here via a chat "proceed" or via the
        // outline "Create Presentation" button. The finally block below calls
        // toggleGenerateLoading(false) to clear it once streaming settles.
        const btnGenerateSend = document.getElementById('btn-generate');
        if (btnGenerateSend) {
            btnGenerateSend.classList.add('is-generating');
            btnGenerateSend.disabled = false;
        }
        const btnLangSend = document.getElementById('btn-lang-dropdown');
        if (btnLangSend) btnLangSend.disabled = true;

        window.removeEventListener('resize', scaleIframe); // evita acumulación

        // Transition: called once when the final generation request starts, then
        // the iframe is filled incrementally as SSE HTML chunks arrive.
        let _hasTransitioned = false;
        const doTransitionToPreview = window.AedosGeneration.createGenerationPreviewTransition({
            window,
            document,
            generationState,
            generation,
            getHasTransitioned: () => _hasTransitioned,
            setHasTransitioned: value => { _hasTransitioned = value; },
            chatScreen,
            previewHeader,
            previewContainer,
            previewState,
            stopBtnMessages,
            resetMobileZoomState,
            updateZoomDisplay,
            clearStageInlinePadding,
            scaleIframe,
            requestAnimationFrame: callback => requestAnimationFrame(callback),
            setTimeout: (...args) => setTimeout(...args),
        });

        previewUiState.minimapAlreadyInit = false;
        previewUiState.toolsAlreadyInit = false;
        const rawIframe = previewState.previewIframe.cloneNode();
        previewState.previewIframe.parentNode.replaceChild(rawIframe, previewState.previewIframe);
        previewState.previewIframe = rawIframe;

        // Clear Minimap and Dots
        const minimapList = document.getElementById('minimap-list');
        if (minimapList) {
            minimapList.innerHTML = '';
            minimapList.style.transform = 'none'; // Reset scrolling
            const mmContainer = document.getElementById('editor-minimap');
            if (mmContainer) {
                mmContainer.style.removeProperty('--presentation-accent');
                mmContainer.style.removeProperty('--accent');
            }
        }
        if (slideDots) slideDots.innerHTML = '';

        const iframeDoc = previewState.previewIframe.contentDocument || previewState.previewIframe.contentWindow.document;
        setPreviewStreamStatus(generationState.proModeEnabled ? 'Analizando contenido…' : 'Generando presentación…');
        doTransitionToPreview();
        // Writing every model token directly into a live iframe forces a full
        // document/layout pass for each chunk. On slower machines that can make
        // the tab unresponsive while Pro mode is composing Stage 3. Buffer the
        // stream and flush it at a short cadence instead of waiting for a large
        // byte threshold or for the final response.
        const previewMarkupBuffer = window.AedosPreview.createPreviewMarkupBuffer({ iframeDoc, setTimeout, clearTimeout });
        const G_FONTS = `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
        const loadingHtml = `
        ${G_FONTS}
        <style class="skeleton-injector">
            body { background: #121212; margin: 0; padding: 0; }
        </style>
        <link rel="stylesheet" href="/editor/editor.css?v=3">
        <script type="module" src="/editor/editor.js?v=4"></script>
        `;

        const tema = document.getElementById('w-tema').value.trim();
        const previewLabel = document.getElementById('preview-topic-label');
        if (previewLabel) {
            if (previewLabel.tagName === 'INPUT') previewLabel.value = tema;
            else previewLabel.textContent = tema;
        }

        slideLabel.textContent = "1 / 1";
        updateMinimapSkeleton(1);

        // Activate the new Claude-style thinking panel BEFORE the network
        // request goes out so the user sees the elapsed-time counter from
        // the very first moment. The panel auto-expands as soon as reasoning
        // tokens arrive and collapses once the HTML stream begins.
        try {
            const _aiMessages = document.querySelectorAll('.chat-msg-ai');
            const _latestAi = _aiMessages[_aiMessages.length - 1];
            const _aiBody = _latestAi && _latestAi.querySelector('.chat-ai-body');
            if (_aiBody && window.AedosThinking) {
                window.AedosThinking.show(_aiBody, {
                    label: generationState.proModeEnabled
                        ? (window.__t ? window.__t('chat_proceeding_1', 'Analyzing request…') : 'Analyzing request…')
                        : (window.__t ? window.__t('chat_thinking', 'Thinking…') : 'Thinking…'),
                    stage: generationState.proModeEnabled ? 'stage1' : 'flash'
                });
            }
        } catch (_) { /* non-critical */ }
        return { generation, iframeDoc, previewMarkupBuffer, G_FONTS, loadingHtml, tema, previewLabel, hasTransitioned: () => _hasTransitioned };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createFinalGenerationSetup = createFinalGenerationSetup;
})(window);
