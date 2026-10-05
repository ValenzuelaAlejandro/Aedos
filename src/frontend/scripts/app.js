document.addEventListener('DOMContentLoaded', () => {
    const generationState = window.AedosStores.generation.state;
    const previewState = window.AedosStores.previewEditor.state;
    const chatState = {};
    const uiLog = window.BrowserLogger
        ? window.BrowserLogger.createLogger({ scope: 'UI', minLevel: 'debug' })
        : {
            debug: () => { },
            info: () => { },
            success: () => { },
            warn: () => { },
            error: () => { }
        };

    window.AedosAttachments.createPageDropGuard();

    // =========================================================
    // DOM ELEMENTS
    // =========================================================
    const chatScreen = document.getElementById('chat-screen');
    const previewContainer = document.getElementById('preview-container');
    const resultContainer = document.getElementById('result-container');
    const errorContainer = document.getElementById('error-container');
    const refusedContainer = document.getElementById('refused-container');
    const refusedMessage = document.getElementById('refused-message');
    const errorModal = window.AedosModals.createErrorModal(errorContainer);

    const downloadBtn = document.getElementById('download-btn');
    const resultSubtitle = document.getElementById('result-subtitle');
    const resetBtn = document.getElementById('reset-btn');
    const backBtn = document.getElementById('back-btn');
    const errorMessage = document.getElementById('error-message');
    const temaError = document.getElementById('tema-error');

    const showErrorModal = errorModal.show;

    // Wire error modal close/action buttons
    const _errCloseBtnEl = document.getElementById('error-modal-close-btn');
    if (_errCloseBtnEl) _errCloseBtnEl.addEventListener('click', errorModal.dismiss);

    window.AedosModals.createRefusedModalClose({ refusedContainer, chatScreen });

    // Preview elements
    previewState.previewIframe = document.getElementById('preview-iframe');
    const slideDots = document.getElementById('slide-dots');
    const slideLabel = document.getElementById('slide-label');
    const mobileSlideDots = document.getElementById('mobile-slide-dots');
    const mobileSlideLabel = document.getElementById('mobile-slide-label');
    const previewHeader = document.querySelector('.preview-unified-header');
    const finalizeBtn = document.getElementById('finalize-btn');
    const progressBarEl = document.getElementById('loading-progress-bar');
    const previewStreamStatus = document.getElementById('preview-stream-status');
    const previewStreamStatusText = document.getElementById('preview-stream-status-text');

    const setPreviewStreamStatus = window.AedosPreview.createPreviewStreamStatus({
        statusText: previewStreamStatusText,
        statusElement: previewStreamStatus,
    });

    const updateMinimapSkeleton = window.AedosMinimapView.createSkeletonUpdater({ document });

    // State
    // Preview state is owned by the shared preview/editor store.
    let _refreshSlotOverlays = null; // assigned in injectImageReplacementSystem
    let _overlayMap = new Map(); // slotEl -> { input, label }
    let _stabilizeMinimapOnNextPreviewInit = false;

    const resetUI = window.AedosAppReset.createResetController({
        document,
        errorModal,
        resultContainer,
        errorContainer,
        refusedContainer,
        previewContainer,
        chatScreen,
        previewState,
        clearSlotOverlays: () => { _refreshSlotOverlays = null; },
        slideDots,
        mobileSlideDots,
        mobileSlideLabel,
        progressBarEl,
        chatState,
        startTypewriter,
    });

    // Panel insets used by scaleIframe to account for floating panel overlay.
    // GSAP tweens this object during the settling animation so scaleIframe can
    // call getBoundingClientRect once and derive both scale and centering offset.
    // Tracks the active settling GSAP tween so we can kill it before a new generation
    // starts (prevents the previous onComplete from firing showFloatingPills mid-stream).
    // Generation/iframe identity used to ignore late messages and callbacks from
    // a previous stream after the preview iframe has been replaced.
    const MOBILE_BREAKPOINT =
        window.MobileConfig && Number.isFinite(window.MobileConfig.breakpoint)
            ? window.MobileConfig.breakpoint
            : 850;

    const modeBtn = document.getElementById('btn-mode-dropdown');
    const modeMenu = document.getElementById('mode-dropdown-menu');
    const langBtn = document.getElementById('btn-lang-dropdown');
    const langMenu = document.getElementById('lang-dropdown-menu');
    const exportMenuBtn = document.getElementById('export-menu-trigger');
    const exportMenu = document.getElementById('export-dropdown-menu');
    const exportPptxBtn = document.getElementById('export-pptx-btn');
    const currentModeLabel = document.getElementById('current-mode-label');
    const currentLangLabel = document.getElementById('current-lang-label');
    const chatInputWrapper = document.querySelector('.chat-input-wrapper');

    window.AedosAppDropdowns.createAppDropdowns({
        document,
        window,
        generationState,
        finalizeBtn,
        elements: {
            modeBtn, modeMenu, langBtn, langMenu, exportMenuBtn, exportMenu,
            exportPptxBtn, currentModeLabel, currentLangLabel, chatInputWrapper,
        },
    });

    // Listen for messages from iframe during skeleton generation
    window.addEventListener('message', (e) => {
        if (!e.data) return;
        // A removed streaming iframe may still have a queued postMessage. Never
        // let that stale event advance the current generation's UI state.
        if (e.source && previewState.previewIframe && previewState.previewIframe.contentWindow && e.source !== previewState.previewIframe.contentWindow) return;
        if (e.data.type === 'slideUpdate') {
            const count = e.data.count;
            previewState.totalSlides = count;
            if (slideLabel) {
                const tpl = window.__t("slide_label_tpl", "{current} / {total}");
                slideLabel.textContent = tpl.replace('{current}', count).replace('{total}', count);
            }
            previewState.currentSlide = count - 1;
            if (previewContainer && previewContainer.classList.contains('is-generating')) {
                setPreviewStreamStatus(`Generando presentación… ${count} slide${count === 1 ? '' : 's'} recibida${count === 1 ? '' : 's'}`);
            }

            // The preview is now entered optimistically when /generate starts;
            // slideUpdate only advances the live progress indicator and dots.

            // Rebuild dots and minimap skeletons during generation.
            // During soft-regen the minimap stays frozen on the old thumbnails until
            // buildMinimap() replaces them after the final render.
            if (typeof buildDots === 'function') buildDots();
            if (!previewUiState.skipMinimapSkeleton) updateMinimapSkeleton(count);
        }
        if (e.data.type === 'titleUpdate') {
            const previewLabel = document.getElementById('preview-topic-label');
            if (previewLabel) {
                // Keep it short if it's too long
                let t = e.data.title.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (t.length > 50) t = t.substring(0, 47) + '...';
                previewLabel.textContent = t;

            }
        }
    });

    // --- i18n is now handled globally by i18n.js ---

    // =========================================================
    // TOP PANEL CONTROLS (THEME + LANGUAGE)
    // =========================================================
    window.AedosThemeController.initialize(previewState);

    window.AedosAppTooltips.initialize();

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }

    // =========================================================
    // INPUT PLACEHOLDER (NATIVE)
    // =========================================================
    chatState.typewriterCursor = null;
    chatState.chatPlaceholderContainer = null;
    chatState.typewriterRunning = false;
    function startTypewriter() { }
    function stopTypewriter() { }

    window.AedosAppRouter.createRouter({ generationState });

    // Clear error on typing and validate length
    const temaInput = document.getElementById('w-tema');
    const btnGenerate = document.getElementById('btn-generate');

    // ── File Upload Logic ───────────────────────────────────────────────
    const btnAttachFile = document.getElementById('btn-attach-file');
    const fileUploadInput = document.getElementById('file-upload-input');
    const attachmentPreviewContainer = document.getElementById('attachment-preview-container');

    window.AedosAttachments.createAttachments({
        btnAttachFile,
        fileUploadInput,
        attachmentPreviewContainer,
        validateGenerateButton
    });

    function validateGenerateButton() {
        if (btnGenerate && btnGenerate.classList.contains('is-generating')) {
            return;
        }

        const val = temaInput ? temaInput.value.trim() : '';
        const hasFiles = window._attachedFiles && window._attachedFiles.length > 0;
        const isActive = val.length >= 4 || hasFiles;

        if (btnGenerate) {
            btnGenerate.disabled = !isActive;
        }

        // Animate hero title dynamically based on active state and language
        if (isActive) {
            if (!generationState.heroCustomTextActive) {
                generationState.heroCustomTextActive = true;
                animateHeroTitle(window.__t('hero_active'));
            }
        } else {
            if (generationState.heroCustomTextActive) {
                generationState.heroCustomTextActive = false;
                animateHeroTitle(window.__t('hero_line_1'));
            }
        }
    }
    window.validateGenerateButton = validateGenerateButton;
    // ─────────────────────────────────────────────────────────────────────


    window.AedosChatInput.createChatInputController({
        temaInput,
        btnGenerate,
        temaError,
        document,
        window,
        validateGenerateButton,
        state: chatState
    });

    // =========================================================
    // 5. GENERATE BUTTON
    // =========================================================
    const generateBtn = document.getElementById('btn-generate');



    const {
        animateHeroTitle,
        pauseBtnMessages,
        resumeBtnMessages,
        stopBtnMessages,
        toggleGenerateLoading,
    } = window.AedosChatLoading.createChatLoadingController({
        state: chatState,
        document,
        window,
        temaInput,
        generateBtn,
        modeBtn,
        langBtn,
        btnAttachFile,
        validateGenerateButton,
        stopTypewriter,
        getUpdateZoomDisplay: () => typeof updateZoomDisplay === 'function' ? updateZoomDisplay : null,
    });

    function resetPreviewSurface() {
        window.removeEventListener('resize', scaleIframe);

        previewUiState.minimapAlreadyInit = false;
        previewUiState.toolsAlreadyInit = false;
        const rawIframe = previewState.previewIframe.cloneNode();
        previewState.previewIframe.parentNode.replaceChild(rawIframe, previewState.previewIframe);
        previewState.previewIframe = rawIframe;

        const minimapList = document.getElementById('minimap-list');
        if (minimapList) {
            minimapList.innerHTML = '';
            minimapList.style.transform = 'none';
            const mmContainer = document.getElementById('editor-minimap');
            if (mmContainer) {
                mmContainer.style.removeProperty('--presentation-accent');
                mmContainer.style.removeProperty('--accent');
            }
        }

        if (slideDots) slideDots.innerHTML = '';
        previewState.slideContainer = null;
        _refreshSlotOverlays = null;
        _overlayMap = new Map();
    }

    const handleProceedFlow = window.AedosGeneration.createProceedFlow({ window, document });
    const handleSkeletonError = window.AedosGeneration.createSkeletonErrorPresenter({
        window,
        document,
        generationState,
        toggleGenerateLoading,
        errorMessage,
        showErrorModal,
        escapeHtml: window.escapeHtml,
    });

    const handleGenerate = window.AedosGeneration.createSkeletonGeneration({
        window, document, generateBtn, generationState, toggleGenerateLoading,
        temaInput, temaError, FormData, AbortController, fetch,
        handleProceedFlow, handleSkeletonError
    });

    window.proceedWithCurrentOutline = window.AedosGeneration.createApprovedOutlineProceed({
        window,
        document,
        generationState,
        temaInput,
        FormData,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
    });

    const showStageProgress = window.AedosGeneration.createStageProgress({
        window,
        previewContainer,
        generateBtn,
        pauseBtnMessages,
        setPreviewStreamStatus,
        animateHeroTitle,
    });
    const appendReasoningProgress = window.AedosGeneration.createReasoningProgress({ window, document });

    window.startFinalGeneration = async function (skeleton) {
        // Enter the live preview immediately. The server emits real SSE progress
        // before its first HTML chunk (especially in Pro mode), so waiting for
        // parsed.chunk makes the UI look frozen during the pipeline stages.
        const generation = {
            id: ++generationState.sequence,
            finalPreviewMounted: false,
            transitionStarted: false
        };
        generationState.activeGeneration = generation;
        _pendingTransitionFn = null;

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

        try {
            if (generationState.activeController) {
                console.warn("A generation is already in progress. Ignoring duplicate request.");
                return;
            }
            
            const controller = new AbortController();
            generationState.activeController = controller;

            let bodyData = window._pendingGenerateBodyData;
            let headers = window._pendingGenerateHeaders || {};

            // Bug #3: Clone body data so we don't mutate the original FormData/JSON
            // (multiple retries would otherwise accumulate extra 'skeleton' fields)
            if (bodyData instanceof FormData) {
                const cloned = new FormData();
                for (const [key, val] of bodyData.entries()) {
                    if (key !== 'files' && key !== 'mode') {
                        cloned.append(key, val);
                    }
                }
                // Restore actual generation mode (skeleton was tagged 'chat' for rate limiting)
                if (generationState.proModeEnabled) cloned.append('mode', 'pro');
                cloned.append('skeleton', JSON.stringify(skeleton));
                bodyData = cloned;
            } else {
                const parsed = JSON.parse(bodyData);
                parsed.skeleton = skeleton;
                // Restore actual generation mode (skeleton was tagged 'chat' for rate limiting)
                if (generationState.proModeEnabled) {
                    parsed.mode = 'pro';
                } else {
                    delete parsed.mode;
                }
                bodyData = JSON.stringify(parsed);
            }

            const response = await fetch('/generate', {
                method: 'POST',
                headers: headers,
                body: bodyData,
                signal: controller.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const serverErr = errorData.error || `Server error: ${response.status}`;
                const retryAfter = Number(errorData.retryAfterSec);
                if (Number.isFinite(retryAfter) && retryAfter > 0) {
                    throw new Error(`${serverErr}|RETRY_AFTER=${retryAfter}`);
                }
                throw new Error(serverErr);
            }

            const reader = response.body.getReader();
            let firstWrite = true;
            const _generateReasoningAiBody = (() => {
                const _aiMessages = document.querySelectorAll('.chat-msg-ai');
                const _latestAi = _aiMessages[_aiMessages.length - 1];
                return _latestAi && _latestAi.querySelector('.chat-ai-body');
            })();
            const writeInitialStreamMarkup = window.AedosPreview.createInitialStreamMarkup({
                window,
                iframeDoc,
                generationState,
                setPreviewStreamStatus,
                reasoningBody: _generateReasoningAiBody,
                fontLinks: G_FONTS,
                loadingHtml,
            });
            // Safety timeout: if no SSE data arrives within a period, abort to prevent
            // an infinite hang when the server closes without sending {done:true}.
            // Pro mode (3-stage pipeline) can take longer, so use a longer timeout that also
            // resets when we receive pipeline stage updates (not just HTML chunks).
            const SSE_WATCHDOG_MS = 600000; // 10 minutes total, enough for all 3 Pro stages
            let sseWatchdog;
            const resetWatchdog = () => {
                clearTimeout(sseWatchdog);
                sseWatchdog = setTimeout(() => {
                    uiLog.warn('STREAM', 'SSE watchdog fired without activity, cancelling reader', {
                        timeoutMs: SSE_WATCHDOG_MS
                    });
                    reader.cancel();
                }, SSE_WATCHDOG_MS);
            };
            resetWatchdog();

            const generationEvents = window.AedosHttpSse.readReader(reader, {
                framing: 'event',
                flushTail: true,
                onChunk: resetWatchdog
            });
            for await (const { data: dataStr, tail } of generationEvents) {
                if (tail) {
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (parsed.chunk) previewMarkupBuffer.queue(window.AedosContentUtils.sanitizeModelOutput(parsed.chunk));
                        if (parsed.done && parsed.html) previewState.generatedHtml = parsed.html;
                    } catch (e) { }
                    continue;
                }
                if (dataStr.trim() === '[DONE]') continue;
                let parsed;
                try { parsed = JSON.parse(dataStr); } catch (e) { continue; }

                        if (parsed.queued === true) {
                            pauseBtnMessages();
                            const label = generateBtn.querySelector('.btn-generate-label');
                            if (label) {
                                const msg = window.__t("queued_position", "Waiting in queue — position {pos}");
                                label.textContent = msg.replace('{pos}', parsed.position);
                            }
                            continue;
                        }
                        if (parsed.queued === false) {
                            resumeBtnMessages();
                            continue;
                        }

                        // Reasoning tokens stream — surface them in the new
                        // thinking panel. We use the latest AI bubble as the
                        // host (the same one that shows the "Drafting
                        // slides…" status text). For Pro mode, the server
                        // tags reasoning with a `stage` field so we can
                        // update the panel's accent color and label.
                        if (parsed.reasoning && typeof parsed.reasoning === 'string') {
                            appendReasoningProgress(parsed);
                            continue;
                        }

                        // Pipeline stage progress events
                        if (parsed.pipeline) {
                            showStageProgress(parsed);
                            continue;
                        }

                            if (parsed.chunk) {
                                if (firstWrite) {
                                    firstWrite = false;
                                    writeInitialStreamMarkup();
                                }
                                previewMarkupBuffer.queue(window.AedosContentUtils.sanitizeModelOutput(parsed.chunk));
                        }
                        if (parsed.refused) {
                            _pendingTransitionFn = null;
                            _stabilizeMinimapOnNextPreviewInit = false;
                            chatScreen.style.cssText = '';
                            chatScreen.classList.remove('hidden');
                            refusedMessage.textContent = parsed.message || (window.__t ? window.__t('refused_msg', "This topic cannot be generated.") : "This topic cannot be generated.");
                            refusedContainer.classList.remove('hidden');
                            previewContainer.classList.add('hidden');
                            iframeDoc.close();
                            toggleGenerateLoading(false);
                            // Reset title/subtitle to defaults for next generation error
                            const eTitleEl = document.getElementById('t-error-title');
                            if (eTitleEl) eTitleEl.setAttribute('data-i18n', 'error_title');
                            return;
                        }
                        if (parsed.error) {
                            throw new Error(parsed.error);
                        }
                        if (parsed.metadata) {
                            uiLog.info('GENERATION', 'Model Selected', { provider: parsed.metadata.provider, model: parsed.metadata.model });
                            continue;
                        }
                        if (parsed.done) {
                            previewState.generatedHtml = parsed.html;
                            let displayTitle = tema;
                            const configMatch = previewState.generatedHtml.match(/<!--\s*CONFIG\s*([\s\S]*?)\s*-->/i);
                            if (configMatch) {
                                try {
                                    const configObj = JSON.parse(configMatch[1]);
                                    if (configObj.Clean_Topic) displayTitle = configObj.Clean_Topic;
                                } catch (e) { }
                            }
                            if (displayTitle === tema) {
                                const titleMatch = previewState.generatedHtml.match(/<title>\s*(.*?)\s*<\/title>/i);
                                if (titleMatch && titleMatch[1]) {
                                    displayTitle = titleMatch[1];
                                } else {
                                    const h1Match = previewState.generatedHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                                    if (h1Match && h1Match[1]) {
                                        displayTitle = h1Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                                    }
                                }
                            }
                            if (previewLabel) {
                                if (previewLabel.tagName === 'INPUT') previewLabel.value = displayTitle;
                                else previewLabel.textContent = displayTitle;
                            }
                            previewState.currentTitle = displayTitle;
                        }
            }

            clearTimeout(sseWatchdog);

            if (!previewState.generatedHtml || previewState.generatedHtml.trim().length < 50) {
                throw new Error(window.__t ? window.__t('error_generation_failed', "Sorry, could not generate the presentation correctly.") : "Sorry, could not generate the presentation correctly.");
            }

            previewMarkupBuffer.finish();

            await window.AedosPreview.createFinalPreviewReveal({
                window, document, iframeDoc, generationState, generation,
                previewState, previewUiState, previewContainer, previewHeader,
                initPreview, scaleIframe,
                clearPendingTransition: () => { _pendingTransitionFn = null; },
                setTimeout
            })();

        } catch (error) {
            previewMarkupBuffer.clearTimer();
            previewMarkupBuffer.markClosed();
            if (generationState.activeGeneration === generation) {
                generationState.activeGeneration = null;
                _pendingTransitionFn = null;
            }
            if (generationState.activeController && generationState.activeController.signal.aborted) {
                return;
            }
            _stabilizeMinimapOnNextPreviewInit = false;

            // Ignore intentional user cancellations (Back button)
            if (error.name === 'AbortError') {
                // Bug #17: clean up generating state even on abort
                const btnOutlineGenerate = document.getElementById('btn-outline-generate');
                if (btnOutlineGenerate) btnOutlineGenerate.classList.remove('is-generating');
                iframeDoc.close();
                return;
            }

            window.AedosGeneration.createErrorPresenter({
                window,
                document,
                uiLog,
                errorMessage,
                previewContainer,
                chatScreen,
                showErrorModal,
                clearInterval,
            })(error, iframeDoc, _hasTransitioned);
        } finally {
            generationState.activeController = null;
            toggleGenerateLoading(false);
            // Re-enable minimap skeleton updates for subsequent normal generations.
            previewUiState.skipMinimapSkeleton = false;
            // is-generating is cleared by the reveal callback (success) or catch block (error).
            // Do NOT remove it here — that would cause panels to flash before the reveal animation.
            _pendingTransitionFn = null;
        }
    }

    generateBtn.addEventListener('click', () => handleGenerate());
    const openPreviewFromExistingHtml = window.AedosPreview.createExistingHtmlPreview({
        window,
        document,
        previewState,
        chatScreen,
        previewContainer,
        resultContainer,
        errorContainer,
        refusedContainer,
        previewHeader,
        slideLabel,
        resetPreviewSurface,
        updateZoomDisplay: () => updateZoomDisplay(),
        updateMinimapSkeleton,
        initPreview,
        getScaleIframe: () => scaleIframe,
        clearPendingTransition: () => { _pendingTransitionFn = null; },
    });
    window.AedosPreview.createDebugCanvas({
        window,
        document,
        fetch,
        previewContainer,
        chatScreen,
        errorContainer,
        errorMessage,
        showErrorModal,
        resetUI,
        extractTitle: window.AedosPreview.extractDebugCanvasTitle,
        openPreview: openPreviewFromExistingHtml,
    }).initialize();



    // Preview actions (Edit / Regenerate / Back)
    const btnBackToChat = document.getElementById('btn-back-to-chat');
    if (btnBackToChat) {
        btnBackToChat.addEventListener('click', () => {
            const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
            if (!confirm(msg)) return;

            if (generationState.activeController) {
                generationState.activeController.abort();
                generationState.activeController = null;
            }
            
            window.navigateToHome();
            
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
                const temaInput = document.getElementById('w-tema');
                if (temaInput) temaInput.focus();
            }, 50);
        });
    }

    const btnEditTopic = document.getElementById('btn-edit-topic');
    if (btnEditTopic) {
        btnEditTopic.addEventListener('click', () => {
            const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
            if (!confirm(msg)) return;

            if (generationState.activeController) {
                generationState.activeController.abort();
                generationState.activeController = null;
            }
            
            window.navigateToHome();
            
            setTimeout(() => {
                const temaInput = document.getElementById('w-tema');
                if (temaInput) temaInput.focus();
            }, 50);
        });
    }

    // =========================================================
    // 6. PREVIEW SYSTEM
    // =========================================================

    let mountPreview;
    function initPreview(html, callback) {
        return mountPreview(html, callback);
    }

    mountPreview = window.AedosPreview.createIframeMount({
        previewState,
        uiLog,
        document,
        getFindSlides: () => findSlides,
        getSetupPreviewInteractions: () => setupPreviewInteractions,
        requestAnimationFrame,
        setTimeout,
        getLocalStorage: () => localStorage,
    });
    const findSlides = window.AedosPreview.createSlideDiscovery();

    const previewUiState = {
        minimapAlreadyInit: false,
        toolsAlreadyInit: false,
        skipMinimapSkeleton: false
    };
    // True during soft-regen streaming: blocks updateMinimapSkeleton so the existing
    // real thumbnails stay visible (instead of being cleared and replaced by skeleton items
    // the moment skeleton-injector fires its first postMessage).
    const { setupPreviewInteractions, syncZoomStateWithViewportMode, updateZoomDisplay, isMobileViewport, resetMobileZoomState } = window.AedosPreview.createPreviewInteractions({
        getDeps: () => ({ previewState, previewUiState, previewHeader, uiLog, handleSlideWheelNav, handleTouchStart, handleTouchEnd, injectImageReplacementSystem, scrollToSlide, updateSlideCounter, buildDots, scaleIframe, updateMinimapSkeleton, isMobileViewport, findSlides, getRefreshSlotOverlays: () => _refreshSlotOverlays, getOverlayMap: () => _overlayMap, getBuildOverlayForSlot: () => _buildOverlayForSlot, getStabilizeMinimapOnNextPreviewInit: () => _stabilizeMinimapOnNextPreviewInit, setStabilizeMinimapOnNextPreviewInit: (value) => { _stabilizeMinimapOnNextPreviewInit = value; } }),
        MOBILE_BREAKPOINT,
    });

    const { scaleIframe, handleFullscreenChange, clearStageInlinePadding } = window.AedosPreview.createIframeScale({ previewState, previewContainer, syncZoomStateWithViewportMode, updateZoomDisplay, getRefreshSlotOverlays: () => _refreshSlotOverlays });
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    let _buildOverlayForSlot = () => {}; // forward declaration used by state restore
    const injectImageReplacementSystem = window.AedosPreview.createImageSlotOverlaySystem({
        window,
        document,
        previewState,
        getOverlayMap: () => _overlayMap,
        getReplaceSlotImage: () => replaceSlotImage,
        getReplaceSlotWithUrl: () => replaceSlotWithUrl,
        setRefreshSlotOverlays: callback => { _refreshSlotOverlays = callback; },
        setBuildOverlayForSlot: callback => { _buildOverlayForSlot = callback; },
        isMobileViewport,
        setTimeout,
        CustomEvent,
    });


    const { replaceSlotImage, replaceSlotWithUrl } = window.AedosPreview.createSlotImageReplacement({ contentUtils: window.AedosContentUtils });

    const { scrollToSlide, tryNavigate, navigationState, buildDots, updateSlideCounter } = window.AedosPreview.createSlideNavigation({ previewState, slideDots, slideLabel, mobileSlideDots, mobileSlideLabel, findSlides, getRefreshSlotOverlays: () => _refreshSlotOverlays });

    const { handleSlideWheelNav, handleTouchStart, handleTouchEnd } = window.AedosPreview.createSlideInputHandlers({ previewContainer, previewState, navigationState, tryNavigate, uiLog });

    window.AedosExport.createExportActions({ finalizeBtn, errorMessage, previewState, generationState, showErrorModal });

    resetBtn.addEventListener('click', resetUI);
    // back-btn: dismiss error modal then call the context-specific dismiss action
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            errorModal.dismiss();
            // If no callback, just close the modal — stay on whatever screen is active
        });
    }
    document.getElementById('refused-back-btn').addEventListener('click', () => {
        refusedContainer.classList.add('hidden');
        resetUI();
    });

    window.AedosPreview.createOutsideDeselect({ document, previewContainer, previewState });

    // Global helper for chips
    window.AedosChatInput.registerFillInput({ window, document, Event });

    // Scroll is now native; no custom scroll-loop system
});

// -- Suggestion Pills Logic ---------------------------------------------------
window.AedosChatInput.registerSuggestionPills({ document, window, Event });
