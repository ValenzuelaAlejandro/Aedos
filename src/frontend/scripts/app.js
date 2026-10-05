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

    function setPreviewStreamStatus(text) {
        if (!previewStreamStatusText || typeof text !== 'string' || !text.trim()) return;
        previewStreamStatusText.textContent = text;
        if (previewStreamStatus) previewStreamStatus.setAttribute('aria-label', text);
    }

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
    function clearStageInlinePadding() {
        const stageEl = document.getElementById('preview-stage');
        if (!stageEl) return;
        // GSAP writes longhand paddings during settle; clear each one explicitly.
        stageEl.style.padding = '';
        stageEl.style.paddingLeft = '';
        stageEl.style.paddingRight = '';
        stageEl.style.paddingTop = '';
        stageEl.style.paddingBottom = '';
    }

    function resetMobileZoomState() {
        if (window.MobileRuntime && typeof window.MobileRuntime.resetZoomState === 'function') {
            window.MobileRuntime.resetZoomState();
            return;
        }
        window._mobile_zoom = 1;
        window._pan = { x: 0, y: 0 };
    }

    const MOBILE_BREAKPOINT =
        window.MobileConfig && Number.isFinite(window.MobileConfig.breakpoint)
            ? window.MobileConfig.breakpoint
            : 850;

    function isMobileViewport() {
        if (window.MobileRuntime && typeof window.MobileRuntime.isMobileLayout === 'function') {
            return window.MobileRuntime.isMobileLayout();
        }
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

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

    function setPreviewTitle(title) {
        const previewLabel = document.getElementById('preview-topic-label');
        if (!previewLabel) return;

        if (previewLabel.tagName === 'INPUT') previewLabel.value = title;
        else previewLabel.textContent = title;
    }

    function extractPreviewTitleFromHtml(html, fallbackTitle = 'Debug Canvas') {
        return window.AedosPreview.extractDebugCanvasTitle(html, fallbackTitle);
    }

    async function handleGenerate() {
        // If already generating, act as a CANCEL/STOP button!
        if (generateBtn && generateBtn.classList.contains('is-generating')) {
            console.log("Stopping active generation...");
            if (generationState.skeletonController) {
                generationState.skeletonController.abort();
                generationState.skeletonController = null;
            }
            if (window.stopOutlineGeneration) {
                window.stopOutlineGeneration();
            }
            toggleGenerateLoading(false);
            return;
        }

        // Clean up any old error or cancelled messages inside the hardcoded first AI bubble to prevent them from stacking
        const firstAiResponse = document.getElementById('chat-ai-response');
        if (firstAiResponse) {
            firstAiResponse.querySelectorAll('.chat-proceed-message, .chat-cancelled-message, .chat-error-message').forEach(el => el.remove());
        }

        // Abort any previous in-flight skeleton generation
        if (generationState.skeletonController) {
            generationState.skeletonController.abort();
            generationState.skeletonController = null;
        }

        // Push state immediately so the native back button works during the loading phase
        if (window.location.hash !== '#chat') {
            window.navigateToChat();
        }

        const tema = temaInput.value.trim();
        const hasFiles = window._attachedFiles && window._attachedFiles.length > 0;
        if (!tema && !hasFiles) {
            temaError.classList.add('visible');
            temaInput.focus();
            return;
        }
        temaError.classList.remove('visible');

        const finalTema = tema || (hasFiles ? (window.__t ? window.__t('default_document_prompt', 'Analyze this document and create a presentation') : 'Analyze this document and create a presentation') : '');

        const requestData = {
            tema: finalTema,
            mode: 'chat', // skeleton always draws from the chat rate-limit bucket
            ...(generationState.targetLanguage !== 'auto' ? { language: generationState.targetLanguage } : {})
        };

        const isFollowUpRequest = window.outlineEditorState && window.outlineEditorState.skeleton !== null;

        if (isFollowUpRequest) {
            requestData.currentSkeleton = JSON.stringify(window.outlineEditorState.skeleton);
            // Backup the current skeleton in case the next instruction is a "proceed/create" action
            window._backupSkeleton = JSON.parse(JSON.stringify(window.outlineEditorState.skeleton));
        } else {
            window._backupSkeleton = null;
        }

        toggleGenerateLoading(true);

        let bodyData;
        let headers = {};
        if (window._attachedFiles && window._attachedFiles.length > 0) {
            const formData = new FormData();
            formData.append('tema', requestData.tema);
            if (requestData.mode) formData.append('mode', requestData.mode);
            if (requestData.language) formData.append('language', requestData.language);
            if (requestData.slides !== undefined) formData.append('slides', requestData.slides);
            if (requestData.currentSkeleton) formData.append('currentSkeleton', requestData.currentSkeleton);
            window._attachedFiles.forEach(f => formData.append('files', f));
            bodyData = formData;
        } else {
            headers['Content-Type'] = 'application/json';
            bodyData = JSON.stringify(requestData);
        }

        const controller = new AbortController();
        generationState.skeletonController = controller;

        if (window.showOutlineEditorLoading) {
            window.showOutlineEditorLoading(requestData.slides || 8);
        }

        // Before stream starts, prepare the outline streaming layout (fading pills, moving containers, etc.)
        if (window.prepareOutlineStreaming) {
            window.prepareOutlineStreaming(generationState.proModeEnabled ? 'pro' : 'flash');
        }

        // Only the very first request should mount the panel in the static
        // `#chat-ai-response` bubble. Follow-ups already create their own AI
        // bubble in `showOutlineEditorLoading()`, and re-targeting the static
        // bubble here makes the old top panel look like it is being reused.
        try {
            if (!isFollowUpRequest) {
                const _initialAiBody = document.querySelector('#chat-ai-response .chat-ai-body');
                if (_initialAiBody && window.AedosThinking) {
                    window.AedosThinking.show(_initialAiBody, {
                        label: window.__t ? window.__t('chat_thinking', 'Thinking…') : 'Thinking…',
                        stage: 'stage1'
                    });
                }
            }
        } catch (_) { /* panel is non-critical */ }

        try {
            const skeletonResponse = await fetch('/generate-skeleton', {
                method: 'POST',
                headers: headers,
                body: bodyData,
                signal: controller.signal
            });

            if (!skeletonResponse.ok) {
                const errData = await skeletonResponse.json().catch(() => ({}));
                const serverErr = errData.error || `Server error: ${skeletonResponse.status}`;
                throw new Error(serverErr);
            }

            const skeletonStream = window.AedosHttpSse.openResponse(skeletonResponse, { framing: 'line' });
            let rawText = '';
            let finalSkeleton = null;
            let sawSkeletonSseParseError = false;
            const _skeletonReasoningAiBody = (() => {
                const _aiMessages = document.querySelectorAll('.chat-msg-ai');
                const _latestAi = _aiMessages[_aiMessages.length - 1];
                return _latestAi && _latestAi.querySelector('.chat-ai-body');
            })();

            for await (const { data: dataStr } of skeletonStream.events) {
                if (!dataStr) continue;
                try {
                    const data = JSON.parse(dataStr);
                    if (data.error) {
                        throw new Error(data.error);
                    }

                    // Reasoning tokens — surface in the thinking panel
                    // for the currently active AI bubble. The first
                    // request reuses the static #chat-ai-response;
                    // follow-ups work via showOutlineEditorLoading.
                    if (data.reasoning && typeof data.reasoning === 'string') {
                        const allAiBodies = document.querySelectorAll('.chat-msg-ai .chat-ai-body');
                        const _aiBody = allAiBodies[allAiBodies.length - 1];
                        if (_aiBody && window.AedosThinking) {
                            // Lazily create the panel if a previous
                            // legacy code path forgot to call show().
                            if (!window.AedosThinking.getPanel(_aiBody)) {
                                window.AedosThinking.show(_aiBody, {
                                    label: window.__t ? window.__t('chat_thinking', 'Thinking…') : 'Thinking…',
                                    stage: data.stage || 'stage1'
                                });
                            }
                            window.AedosThinking.appendReasoning(_aiBody, data.reasoning);
                        }
                        continue;
                    }

                    if (data.chunk) {
                        rawText += data.chunk;
                        const partialSkeleton = window.parsePartialSkeleton(rawText);
                        if (window.outlineEditorState) {
                            window.outlineEditorState.skeleton = partialSkeleton;
                        }
                        if (window.renderStreamingOutline) {
                            window.renderStreamingOutline(partialSkeleton);
                        }

                        // Collapse the thinking panel (instead of
                        // hiding it) once the first slide starts
                        // streaming. The pill stays visible so the
                        // user can re-expand it to see what the
                        // model was thinking about.
                        if (partialSkeleton && partialSkeleton.slides && partialSkeleton.slides.length > 0) {
                            if (window.AedosThinking) {
                                window.AedosThinking.collapse(_skeletonReasoningAiBody);
                            }
                            // Legacy fall-back: also hide the old
                            // dot loader if it's still around.
                            const aiMessages = document.querySelectorAll('.chat-msg-ai');
                            const latestAiMessage = aiMessages[aiMessages.length - 1];
                            if (latestAiMessage) {
                                const thinking = latestAiMessage.querySelector('.chat-thinking');
                                if (thinking) thinking.classList.add('hidden');
                            }
                        }
                    }
                    if (data.done) {
                        finalSkeleton = data.skeleton;
                    }
                } catch (e) {
                    sawSkeletonSseParseError = true;
                    console.error('SSE JSON error:', e);
                    if (e.message && (e.message.includes('Limit') || e.message.includes('pressure') || e.message.includes('failed') || e.message.includes('REJECTED'))) {
                        throw e;
                    }
                }
            }

            // The skeleton fetch stream is complete. Free the skeleton controller safely.
            generationState.skeletonController = null;

            window._pendingGenerateBodyData = bodyData;
            window._pendingGenerateHeaders = headers;

            toggleGenerateLoading(false);

            if (!finalSkeleton) {
                finalSkeleton = window.parsePartialSkeleton(rawText);
            }

            const hasRenderableSkeleton = !!(
                finalSkeleton &&
                Array.isArray(finalSkeleton.slides) &&
                finalSkeleton.slides.length > 0
            );

            if (!hasRenderableSkeleton && (!finalSkeleton || !finalSkeleton.action)) {
                const streamWasInterrupted = sawSkeletonSseParseError || rawText.trim().length > 0 || !finalSkeleton;
                if (streamWasInterrupted) {
                    throw new Error(
                        window.__t
                            ? window.__t('outline_stream_interrupted', 'The outline response was interrupted. Please try again.')
                            : 'The outline response was interrupted. Please try again.'
                    );
                }
            }

            // Only hide the panel when nothing useful arrived. If the model
            // streamed reasoning successfully, keep it collapsed so the chat
            // does not look empty after a recoverable failure.
            if (window.AedosThinking) {
                if (!hasRenderableSkeleton) {
                    if (!finalSkeleton || !finalSkeleton.action) {
                        if (window.AedosThinking.hasReasoning && window.AedosThinking.hasReasoning(_skeletonReasoningAiBody)) {
                            window.AedosThinking.collapse(_skeletonReasoningAiBody);
                        } else {
                            window.AedosThinking.hide(_skeletonReasoningAiBody);
                        }
                    }
                } else if (finalSkeleton.action === 'proceed') {
                    // Proceed flow: collapse (not hide) the panel and let
                    // the "Drafting slides…" message take over visually.
                    window.AedosThinking.collapse(_skeletonReasoningAiBody);
                }
            }

            // Intention Parser Interception
            if (finalSkeleton && finalSkeleton.action === 'proceed') {
                const aiMessages = document.querySelectorAll('.chat-msg-ai');
                const latestAiMessage = aiMessages[aiMessages.length - 1];
                if (latestAiMessage) {
                    const thinking = latestAiMessage.querySelector('.chat-thinking');
                    if (thinking) thinking.classList.add('hidden');

                    const aiBody = latestAiMessage.querySelector('.chat-ai-body');
                    if (aiBody) {
                        const progressMsg = document.createElement('div');
                        progressMsg.className = 'chat-proceed-message';
                        progressMsg.style.cssText = 'padding: 0.8rem 1rem; color: var(--text); font-weight: 500; font-family: var(--font-body); display: flex; align-items: center; gap: 0.5rem;';
                        
                        const textSpan = document.createElement('span');
                        textSpan.textContent = window.__t ? window.__t('chat_proceeding_1', 'Analyzing request...') : 'Analyzing request...';
                        
                        progressMsg.innerHTML = `<span style="color: var(--accent); font-size: 1.2rem; display: inline-block;" class="loading-spinner">⟳</span>`;
                        progressMsg.appendChild(textSpan);
                        aiBody.appendChild(progressMsg);
                        
                        // GSAP premium entrance animation for proceed loading message
                        if (window.gsap) {
                            window.gsap.fromTo(progressMsg, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
                        }

                        const spinner = progressMsg.querySelector('.loading-spinner');
                        if (spinner && spinner.animate) {
                            spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1500, iterations: Infinity });
                        }

                        const msgs = [
                            window.__t ? window.__t('chat_proceeding_2', 'Drafting slides...') : 'Drafting slides...',
                            window.__t ? window.__t('chat_proceeding_3', 'Structuring narrative...') : 'Structuring narrative...',
                            window.__t ? window.__t('chat_proceeding_4', 'Finding visual assets...') : 'Finding visual assets...',
                            window.__t ? window.__t('chat_proceeding_5', 'Polishing layout...') : 'Polishing layout...'
                        ];
                        let msgIdx = 0;
                        if (window._proceedMsgInterval) {
                            clearInterval(window._proceedMsgInterval);
                        }
                        window._proceedMsgInterval = setInterval(() => {
                            if (!document.body.contains(progressMsg) || document.body.classList.contains('no-scroll')) {
                                clearInterval(window._proceedMsgInterval);
                                window._proceedMsgInterval = null;
                                return;
                            }
                            if (window.gsap) {
                                window.gsap.to(textSpan, {
                                    opacity: 0,
                                    y: -4,
                                    duration: 0.25,
                                    onComplete: () => {
                                        textSpan.textContent = msgs[msgIdx % msgs.length];
                                        window.gsap.fromTo(textSpan, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
                                        msgIdx++;
                                    }
                                });
                            } else {
                                textSpan.style.opacity = 0;
                                setTimeout(() => {
                                    textSpan.textContent = msgs[msgIdx % msgs.length];
                                    textSpan.style.opacity = 1;
                                    msgIdx++;
                                }, 200);
                            }
                        }, 2500);
                    }
                }

                // Clean up split outline layout and proceed directly
                document.body.classList.remove('split-outline-active');
                
                if (window.startFinalGeneration) {
                    let finalSkeletonObj = (window.outlineEditorState && window.outlineEditorState.skeleton) 
                        ? window.outlineEditorState.skeleton 
                        : finalSkeleton;

                    // If proceeding and the streaming skeleton was empty or parsed as empty, restore from the backup
                    if (window._backupSkeleton && (!finalSkeletonObj || !finalSkeletonObj.slides || finalSkeletonObj.slides.length === 0)) {
                        if (window.outlineEditorState) {
                            window.outlineEditorState.skeleton = window._backupSkeleton;
                        }
                        finalSkeletonObj = window._backupSkeleton;
                    }
                    window.startFinalGeneration(finalSkeletonObj);
                }
                return;
            }

            if (window.finalizeStreamingOutline) {
                window.finalizeStreamingOutline(finalSkeleton);
            } else {
                throw new Error("Outline editor not initialized");
            }
        } catch (error) {
            if (generationState.skeletonController && controller !== generationState.skeletonController) {
                console.log("Ignoring obsolete skeleton generation error/abort");
                return;
            }
            toggleGenerateLoading(false);
            if (window.outlineEditorState) {
                window.outlineEditorState.isLoading = false;
            }

            const isAbort = error.name === 'AbortError' || error.message?.toLowerCase().includes('abort');

            // Find the latest active AI bubble in the conversation zone to avoid appending to legacy items
            const aiBubbles = document.querySelectorAll('.chat-msg-ai');
            const latestAiBubble = aiBubbles[aiBubbles.length - 1];

            if (latestAiBubble) {
                // Clean up thinking loader in the latest active AI bubble to prevent hanging infinite loader
                const thinking = latestAiBubble.querySelector('.chat-thinking');
                if (thinking) thinking.classList.add('hidden');

                const aiBody = latestAiBubble.querySelector('.chat-ai-body');
                if (aiBody) {
                    // Preserve the reasoning pill on recoverable errors so the
                    // bubble does not look empty. Aborts still remove it.
                    if (window.AedosThinking) {
                        const preserveThinking =
                            !isAbort &&
                            window.AedosThinking.hasReasoning &&
                            window.AedosThinking.hasReasoning(aiBody);
                        if (preserveThinking) {
                            window.AedosThinking.collapse(aiBody);
                        } else {
                            window.AedosThinking.hide(aiBody);
                        }
                    }

                    aiBody.querySelectorAll('.chat-proceed-message, .chat-error-message, .chat-cancelled-message').forEach(el => el.remove());

                    const errEl = document.createElement('div');
                    if (isAbort) {
                        errEl.className = 'chat-cancelled-message';
                        const cancelText = window.__t ? window.__t('generation_cancelled', 'Generation cancelled by user') : 'Generation cancelled by user';
                        errEl.textContent = cancelText;
                    } else {
                        errEl.className = 'chat-error-message';
                        errEl.style.cssText = "color: var(--danger); font-weight: 500; display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem;";
                        errEl.innerHTML = `<span>⚠</span> <span>${escapeHtml(error.message)}</span>`;
                    }
                    aiBody.appendChild(errEl);
                    
                    if (window.gsap) {
                        window.gsap.fromTo(errEl, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3 });
                    }
                }
            } else {
                // Fallback for ID-based first bubble cleanup
                const thinking = document.getElementById('chat-thinking');
                if (thinking) thinking.classList.add('hidden');
            }

            if (!isAbort) {
                if (errorMessage) errorMessage.textContent = error.message;
                showErrorModal(() => {
                    const outlineContainer = document.getElementById('outline-container');
                    if (outlineContainer) outlineContainer.classList.add('hidden');
                    const backdrop = document.getElementById('outline-backdrop');
                    if (backdrop) backdrop.classList.remove('active');
                    const edgeTab = document.getElementById('outline-edge-tab');
                    if (edgeTab) edgeTab.classList.add('hidden');
                });
            }
        }
    }

    // Direct proceed shortcut: when the user explicitly approves the outline via the
    // primary "Looks good! Create presentation" chip, skip the AI skeleton analysis and
    // immediately start the final generation. This saves a request + tokens that would
    // otherwise be spent re-asking the model to detect the proceed intent from
    // "Todo listo! Crear presentación".
    window.proceedWithCurrentOutline = function() {
        if (window._activeGenController) {
            console.warn("A generation is already in progress. Ignoring proceed request.");
            return;
        }
        if (generationState.skeletonController) {
            generationState.skeletonController.abort();
            generationState.skeletonController = null;
        }

        const skeleton = (window.outlineEditorState && window.outlineEditorState.skeleton)
            ? window.outlineEditorState.skeleton
            : null;
        if (!skeleton || !Array.isArray(skeleton.slides) || skeleton.slides.length === 0) {
            console.warn("proceedWithCurrentOutline: no outline available to proceed with.");
            return;
        }

        if (window.location.hash !== '#chat') {
            window.navigateToChat();
        }

        // Build the same body/headers that handleGenerate would build for the
        // /generate-skeleton call. startFinalGeneration reuses these for /generate.
        const tema = (temaInput && temaInput.value ? temaInput.value.trim() : '') ||
            (window.__t ? window.__t('default_document_prompt', 'Analyze this document and create a presentation') : 'Analyze this document and create a presentation');
        const requestData = {
            tema,
            mode: 'chat',
            ...(generationState.targetLanguage !== 'auto' ? { language: generationState.targetLanguage } : {})
        };
        requestData.currentSkeleton = JSON.stringify(skeleton);

        let bodyData;
        let headers = {};
        if (window._attachedFiles && window._attachedFiles.length > 0) {
            const formData = new FormData();
            formData.append('tema', requestData.tema);
            if (requestData.mode) formData.append('mode', requestData.mode);
            if (requestData.language) formData.append('language', requestData.language);
            if (requestData.slides !== undefined) formData.append('slides', requestData.slides);
            if (requestData.currentSkeleton) formData.append('currentSkeleton', requestData.currentSkeleton);
            window._attachedFiles.forEach(f => formData.append('files', f));
            bodyData = formData;
        } else {
            headers['Content-Type'] = 'application/json';
            bodyData = JSON.stringify(requestData);
        }

        window._pendingGenerateBodyData = bodyData;
        window._pendingGenerateHeaders = headers;

        // Lock outline editor buttons while the final generation runs
        const btnGen = document.getElementById('btn-outline-generate');
        const btnAdd = document.getElementById('btn-outline-add-slide');
        if (btnGen) btnGen.disabled = true;
        if (btnAdd) btnAdd.disabled = true;

        // Mirror the normal "user sent a message" behavior: clear the chip row and
        // any pending chip render so the user can't fire another request mid-flight.
        const chipsContainer = document.getElementById('outline-suggested-chips');
        if (chipsContainer) {
            chipsContainer.innerHTML = '';
            if (window._chipsRenderTimeout) {
                clearTimeout(window._chipsRenderTimeout);
                window._chipsRenderTimeout = null;
            }
        }
        document.querySelectorAll('.suggested-chip').forEach(el => { el.disabled = true; });

        // Mirror the proceed loading UI normally rendered after the AI returns proceed
        const aiMessages = document.querySelectorAll('.chat-msg-ai');
        const latestAiMessage = aiMessages[aiMessages.length - 1];
        if (latestAiMessage) {
            const thinking = latestAiMessage.querySelector('.chat-thinking');
            if (thinking) thinking.classList.add('hidden');

            const aiBody = latestAiMessage.querySelector('.chat-ai-body');
            if (aiBody) {
                aiBody.querySelectorAll('.chat-proceed-message').forEach(el => el.remove());

                const progressMsg = document.createElement('div');
                progressMsg.className = 'chat-proceed-message';
                progressMsg.style.cssText = 'padding: 0.8rem 1rem; color: var(--text); font-weight: 500; font-family: var(--font-body); display: flex; align-items: center; gap: 0.5rem;';

                const textSpan = document.createElement('span');
                textSpan.textContent = window.__t ? window.__t('chat_proceeding_1', 'Analyzing request...') : 'Analyzing request...';

                progressMsg.innerHTML = `<span style="color: var(--accent); font-size: 1.2rem; display: inline-block;" class="loading-spinner">⟳</span>`;
                progressMsg.appendChild(textSpan);
                aiBody.appendChild(progressMsg);

                // Activate (or reactivate) the new Claude-style thinking panel
                // for the proceed flow. Stages 1 and 2 (content + design) are
                // non-streaming on the server, but the server still emits
                // reasoning tokens that we'll pipe into this panel. Once Stage
                // 3 starts, the panel collapses into a "Thought for Ns" pill.
                if (window.AedosThinking) {
                    window.AedosThinking.show(aiBody, {
                        label: window.__t ? window.__t('chat_proceeding_1', 'Analyzing request…') : 'Analyzing request…',
                        stage: generationState.proModeEnabled ? 'stage1' : 'flash'
                    });
                }

                if (window.gsap) {
                    window.gsap.fromTo(progressMsg, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
                }

                const spinner = progressMsg.querySelector('.loading-spinner');
                if (spinner && spinner.animate) {
                    spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1500, iterations: Infinity });
                }

                const msgs = [
                    window.__t ? window.__t('chat_proceeding_2', 'Drafting slides...') : 'Drafting slides...',
                    window.__t ? window.__t('chat_proceeding_3', 'Structuring narrative...') : 'Structuring narrative...',
                    window.__t ? window.__t('chat_proceeding_4', 'Finding visual assets...') : 'Finding visual assets...',
                    window.__t ? window.__t('chat_proceeding_5', 'Polishing layout...') : 'Polishing layout...'
                ];
                let msgIdx = 0;
                if (window._proceedMsgInterval) {
                    clearInterval(window._proceedMsgInterval);
                }
                window._proceedMsgInterval = setInterval(() => {
                    if (!document.body.contains(progressMsg) || document.body.classList.contains('no-scroll')) {
                        clearInterval(window._proceedMsgInterval);
                        window._proceedMsgInterval = null;
                        return;
                    }
                    if (window.gsap) {
                        window.gsap.to(textSpan, {
                            opacity: 0,
                            y: -4,
                            duration: 0.25,
                            onComplete: () => {
                                textSpan.textContent = msgs[msgIdx % msgs.length];
                                window.gsap.fromTo(textSpan, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
                                msgIdx++;
                            }
                        });
                    } else {
                        textSpan.style.opacity = 0;
                        setTimeout(() => {
                            textSpan.textContent = msgs[msgIdx % msgs.length];
                            textSpan.style.opacity = 1;
                            msgIdx++;
                        }, 200);
                    }
                }, 2500);
            }
        }

        document.body.classList.remove('split-outline-active');

        if (window.startFinalGeneration) {
            window.startFinalGeneration(skeleton);
        }
    };

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
        const MAX_STREAM_HTML_CHARS = 2_000_000;
        const STREAM_FLUSH_INTERVAL_MS = 80;
        let streamedHtmlChars = 0;
        let pendingPreviewMarkup = '';
        let previewFlushTimer = null;
        let previewStreamClosed = false;
        const flushPreviewMarkup = () => {
            if (!pendingPreviewMarkup || previewStreamClosed) return;
            iframeDoc.write(pendingPreviewMarkup);
            pendingPreviewMarkup = '';
        };
        const schedulePreviewMarkupFlush = () => {
            if (previewFlushTimer !== null || previewStreamClosed) return;
            previewFlushTimer = setTimeout(() => {
                previewFlushTimer = null;
                flushPreviewMarkup();
            }, STREAM_FLUSH_INTERVAL_MS);
        };
        const queuePreviewMarkup = (markup) => {
            if (!markup) return;
            streamedHtmlChars += markup.length;
            if (streamedHtmlChars > MAX_STREAM_HTML_CHARS) {
                throw new Error('GENERATION_OUTPUT_TOO_LARGE');
            }
            pendingPreviewMarkup += markup;
            // Flush roughly every frame budget, while allowing a larger chunk
            // to be written immediately. This keeps the first slide visible
            // during a long generation without doing one layout pass per token.
            if (pendingPreviewMarkup.length >= 24000) flushPreviewMarkup();
            else schedulePreviewMarkupFlush();
        };
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
                        if (parsed.chunk) queuePreviewMarkup(window.AedosContentUtils.sanitizeModelOutput(parsed.chunk));
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
                            const allAiBodies = document.querySelectorAll('.chat-msg-ai .chat-ai-body');
                            const _aiBody = allAiBodies[allAiBodies.length - 1];
                            if (_aiBody && window.AedosThinking) {
                                if (!window.AedosThinking.getPanel(_aiBody)) {
                                    const stageMap = {
                                        stage1: 'Analyzing request…',
                                        stage2: 'Designing visuals…',
                                        stage3: 'Composing slides…',
                                        flash: 'Drafting slides…'
                                    };
                                    const fallbackLabel = stageMap[parsed.stage] || 'Thinking…';
                                    window.AedosThinking.show(_aiBody, {
                                        label: window.__t ? window.__t('chat_thinking', fallbackLabel) : fallbackLabel,
                                        stage: parsed.stage || 'flash'
                                    });
                                }
                                window.AedosThinking.appendReasoning(_aiBody, parsed.reasoning);
                            }
                            continue;
                        }

                        // Pipeline stage progress events
                        if (parsed.pipeline) {
                            pauseBtnMessages();
                            let stageText;
                            if (parsed.status === 'retrying') {
                                // The AI returned bad JSON / missing fields and the
                                // server is retrying the same stage. Show a clear
                                // "retrying X/Y" message so the user understands the
                                // longer wait is on purpose, not a hang.
                                const tpl = window.__t
                                    ? window.__t('stage_retry', 'The AI stumbled — retrying ({attempt}/{maxAttempts})...')
                                    : 'The AI stumbled — retrying ({attempt}/{maxAttempts})...';
                                const attempt = Number.isFinite(parsed.attempt) ? parsed.attempt : '?';
                                const maxAttempts = Number.isFinite(parsed.maxAttempts) ? parsed.maxAttempts : '?';
                                stageText = tpl.replace('{attempt}', String(attempt)).replace('{maxAttempts}', String(maxAttempts));
                            } else {
                                const stageI18nKeys = {
                                    content: 'stage_content',
                                    design: 'stage_design',
                                    compositing: 'stage_compositing'
                                };
                                const stageFallbacks = {
                                    content: 'Analyzing content...',
                                    design: 'Resolving design...',
                                    compositing: 'Composing slides...'
                                };
                            const i18nKey = stageI18nKeys[parsed.stage];
                            stageText = i18nKey
                                ? (window.__t ? window.__t(i18nKey, stageFallbacks[parsed.stage]) : stageFallbacks[parsed.stage])
                                : parsed.stage;
                            }
                            if (previewContainer && previewContainer.classList.contains('is-generating')) {
                                setPreviewStreamStatus(stageText);
                            }
                            // Update hero title animation
                            if (typeof animateHeroTitle === 'function') animateHeroTitle(stageText);
                            // Also update button label with premium GSAP fade-and-slide animation
                            const label = generateBtn.querySelector('.btn-generate-label');
                            if (label) {
                                if (window.gsap) {
                                    window.gsap.to(label, {
                                        opacity: 0,
                                        y: -5,
                                        duration: 0.2,
                                        onComplete: () => {
                                            label.textContent = stageText;
                                            window.gsap.fromTo(label, { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' });
                                        }
                                    });
                                } else {
                                    label.textContent = stageText;
                                }
                            }
                            continue;
                        }

                            if (parsed.chunk) {
                                if (firstWrite) {
                                    firstWrite = false;
                                    setPreviewStreamStatus(generationState.proModeEnabled ? 'Componiendo slides…' : 'Recibiendo slides…');
                                // Collapse the thinking panel into a "Thought
                                // for Ns" pill now that the slides are about
                                // to render. The user can still re-expand
                                // the panel to read the model's reasoning.
                                if (window.AedosThinking) {
                                    window.AedosThinking.collapse(_generateReasoningAiBody);
                                }
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
                                ${G_FONTS}
                                ${loadingHtml}
                                <script src="/features/skeleton/skeleton-injector.js"></script>
                                `;
                                // Write our trusted skeleton markup directly (no sanitization needed).
                                // Only AI chunks go through sanitizeModelOutput.
                                iframeDoc.write(skelStyle);
                            }
                                queuePreviewMarkup(window.AedosContentUtils.sanitizeModelOutput(parsed.chunk));
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

            if (previewFlushTimer !== null) {
                clearTimeout(previewFlushTimer);
                previewFlushTimer = null;
            }
            flushPreviewMarkup();
            iframeDoc.close();
            previewStreamClosed = true;

            // Fix malformed <link href="url('...')"> that may have slipped through per-chunk
            // sanitization (the tag could be split across two chunks). Uses DOM manipulation
            // since the document is already live at this point.
            try {
                if (iframeDoc && iframeDoc.querySelectorAll) {
                    iframeDoc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                        const raw = link.getAttribute('href') || '';
                        const m = raw.match(/^url\s*\(\s*['"']?(https?[^'"')\s]+)['"']?\s*\)/i);
                        if (m) link.href = m[1];
                    });
                }
            } catch (e) { /* cross-origin guard */ }

            // --- FLICKER GATE: Fade out briefly before final re-render ---
            const stage = document.getElementById('preview-stage');
            if (stage) stage.classList.add('flicker-mask');
            // Soft-regen keeps the minimap visible — don't flicker it.
            const minimapPanel = document.getElementById('editor-minimap');
            if (minimapPanel) minimapPanel.classList.add('flicker-mask');

            // Wait a tiny bit for the fade to start
            await new Promise(r => setTimeout(r, 100));

            // Reset init flags so setupPreviewInteractions reinits minimap+tools with new content.
            // We still clone here even on soft-regen: by this point streaming is finished, so
            // replacing the iframe does not disturb the surrounding editor chrome, and it gives
            // editor.js a fresh window so its one-time guards don't block re-initialization.
            previewUiState.minimapAlreadyInit = false;
            previewUiState.toolsAlreadyInit = false;
            const rawIframe = previewState.previewIframe.cloneNode();
            previewState.previewIframe.parentNode.replaceChild(rawIframe, previewState.previewIframe);
            previewState.previewIframe = rawIframe;

            initPreview(previewState.generatedHtml, () => {
                if (generationState.activeGeneration !== generation) return;
                generation.finalPreviewMounted = true;
                _pendingTransitionFn = null;

                // Restore visibility only after setup is truly complete
                setTimeout(() => {
                    if (generationState.activeGeneration !== generation) return;
                    if (stage) stage.classList.remove('flicker-mask');
                    if (minimapPanel) minimapPanel.classList.remove('flicker-mask');

                    // Revealed the UI chrome with a cinematic sequence.
                    // Keep chrome hidden via is-settling during the GSAP shrink so
                    // panels only appear once the slide has fully settled.
                    // The final render is authoritative. This also covers the
                    // case where the first-slide event was delayed or never
                    // delivered while the tab was backgrounded.
                    previewContainer.classList.remove('hidden', 'is-generating');
                    previewContainer.classList.add('is-settling');

                    // CINEMATIC SHRINK: Tween _editorInsets from 0 to settled values.
                    // scaleIframe reads from this object every frame so the slide smoothly
                    // shrinks and re-centers into the area between the floating panels.
                    // No inline styles are set on the stage element — no CSS fights.
                    if (window.gsap && window.innerWidth > 768) {
                        previewState.settlingAnimation = window.gsap.to(previewState.editorInsets, {
                            left: 165,
                            right: 30,
                            top: 64,
                            bottom: 64,
                            duration: 1.2,
                            ease: "expo.out",
                            onUpdate: () => {
                                // Apply _editorInsets as stage padding so the flex container
                                // centers the slide within the panel-free area — no transform
                                // on the scrollable means no overflow-clipping bug.
                                const stageEl = document.getElementById('preview-stage');
                                if (stageEl) {
                                    stageEl.style.paddingLeft = `${previewState.editorInsets.left}px`;
                                    stageEl.style.paddingRight = `${previewState.editorInsets.right}px`;
                                    stageEl.style.paddingTop = `${previewState.editorInsets.top}px`;
                                    stageEl.style.paddingBottom = `${previewState.editorInsets.bottom}px`;
                                }
                                scaleIframe();
                            },
                            onStart: () => {
                                if (previewHeader) previewHeader.classList.add('slide-down');
                            },
                            onComplete: () => {
                                previewState.settlingAnimation = null;
                                showFloatingPills();
                                scaleIframe();
                            }
                        });
                    } else {
                        if (window.innerWidth > 768) {
                            previewState.editorInsets = { left: 165, right: 30, top: 64, bottom: 64 };
                            const fallbackStage = document.getElementById('preview-stage');
                            if (fallbackStage) {
                                fallbackStage.style.paddingLeft = '165px';
                                fallbackStage.style.paddingRight = '30px';
                                fallbackStage.style.paddingTop = '64px';
                                fallbackStage.style.paddingBottom = '64px';
                            }
                        }
                        if (previewHeader) previewHeader.classList.add('slide-down');

                        // Force immediate scale calculation for mobile/Safari to avoid black-out state
                        scaleIframe();
                        setTimeout(() => { showFloatingPills(); scaleIframe(); }, 800);
                    }

                    function showFloatingPills() {
                        if (previewContainer.classList.contains('is-generating')) {
                            console.error('[Aedos] Preview chrome state conflict: final editor mounted while is-generating remained active.', {
                                generationId: generation.id,
                                transitionStarted: generation.transitionStarted
                            });
                            previewContainer.classList.remove('is-generating');
                        }
                        previewContainer.classList.remove('is-settling');
                        previewContainer.classList.add('is-editor-ready');
                        // Reveal minimap via GSAP for a reliable, explicit opacity fade
                        // (avoids CSS transition timing edge-cases when is-settling is removed).
                        const mm = document.getElementById('editor-minimap');
                        if (mm) {
                            if (window.gsap) {
                                window.gsap.fromTo(mm, { opacity: 0 }, { opacity: 1, duration: 0.65, ease: 'power2.out' });
                            } else {
                                mm.style.opacity = '';
                            }
                        }
                        // NOTE: reveal-tools is intentionally NOT added.
                        // Right panel only opens when the user selects an element.
                    }
                }, 100);
            });

        } catch (error) {
            if (previewFlushTimer !== null) {
                clearTimeout(previewFlushTimer);
                previewFlushTimer = null;
            }
            previewStreamClosed = true;
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
        setPreviewTitle,
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
        extractTitle: extractPreviewTitleFromHtml,
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

    function initPreview(html, callback) {
        let setupDone = false;

        const doSetup = () => {
            if (setupDone) return;
            // Guard: if called before the HTML is parsed (e.g. triggered by the
            // about:blank load of the freshly-cloned iframe), bail out and let
            // the poll retry — do NOT set setupDone so the real load can win.
            const iDoc = previewState.previewIframe.contentDocument ||
                (previewState.previewIframe.contentWindow && previewState.previewIframe.contentWindow.document);
            if (!iDoc || !iDoc.body || findSlides(iDoc).length === 0) return;
            setupDone = true;

            // Safari iOS: safe repaint trigger using rAF + transform nudge.
            // Do NOT use display:none — Safari unloads iframe content on hide.
            try {
                requestAnimationFrame(() => {
                    previewState.previewIframe.style.willChange = 'transform';
                    requestAnimationFrame(() => {
                        previewState.previewIframe.style.willChange = '';
                    });
                });
            } catch (e) { }

            setupPreviewInteractions();
            if (typeof callback === 'function') callback();
        };

        if (html) {
            // Anti-flicker: Prevent scrollbars and margins during initial parse
            const antiFlicker = `<style id="anti-flicker">
                html, body { 
                    overflow: hidden !important; 
                    margin: 0 !important; 
                    padding: 0 !important; 
                }
            </style>`;
            if (!html.includes('anti-flicker')) {
                html = antiFlicker + html;
            }

            // Editor internals are one native module graph inside the iframe.
            const editorScript = /<script\b(?=[^>]*\bsrc=["'][^"']*editor\.js[^"']*["'])[^>]*><\/script>/i;
            const privateEditorScripts = /<script\b(?=[^>]*\bsrc=["'][^"']*\/features\/editor\/(?:semantics|history|selection-geometry)\.js[^"']*["'])[^>]*><\/script>/gi;
            html = html.replace(privateEditorScripts, '');
            const editorModule = '<script type="module" src="/editor/editor.js?v=4"></script>';

            // Ensure the module entrypoint and its stylesheet are present.
            if (!editorScript.test(html)) {
                if (html.includes('</body>')) {
                    html = html.replace('</body>', `<link rel="stylesheet" href="/editor/editor.css?v=3">${editorModule}</body>`);
                } else {
                    html += `<link rel="stylesheet" href="/editor/editor.css?v=3">${editorModule}`;
                }
            } else {
                html = html.replace(editorScript, editorModule);
            }
            // Strip all AI-generated googleapis link tags (may have malformed url() hrefs).
            // Both complete and partial/unclosed tags are removed so the correct G_FONTS
            // block below is always the sole font source.
            html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*\/?>/gi, '');
            html = html.replace(/<link\b[^>]*fonts\.googleapis\.com[^>]*/gi, '');

            // Ensure fonts are present
            if (!html.includes('family=Archivo+Black')) {
                const G_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
                if (html.includes('<head>')) {
                    html = html.replace('<head>', '<head>' + G_FONTS);
                } else {
                    html = G_FONTS + html;
                }
            }

            // Safety Closer: If the AI output ends abruptly (e.g. cut off in mid-comment or mid-tag),
            // force-close them so they don't break the following scripts or icons.
            let safetyCloser = "";
            const openComments = (html.match(/<!--/g) || []).length;
            const closedComments = (html.match(/-->/g) || []).length;
            if (openComments > closedComments) safetyCloser += " -->";

            const openSections = (html.match(/<section/g) || []).length;
            const closedSections = (html.match(/<\/section>/g) || []).length;
            if (openSections > closedSections) safetyCloser += "</section>";

            if (!html.includes('</body>')) safetyCloser += "</body>";
            if (!html.includes('</html>')) safetyCloser += "</html>";

            if (safetyCloser) {
                html += safetyCloser;
            }

            const doc = previewState.previewIframe.contentDocument || previewState.previewIframe.contentWindow.document;
            // Call doc.open() first to cancel any pending about:blank navigation on
            // the freshly-cloned iframe before we attach the onload handler.
            // If onload were set before doc.open(), the blank-document load event
            // could fire our handler 300ms later on an empty document, setting
            // setupDone=true and permanently locking out the real setup.
            doc.open();

            // On some versions of Safari iOS, setting onload after doc.open can be flaky.
            // We use a combination of onload and an immediate next-tick check.
            const onIframeLoad = () => {
                if (setupDone) return;
                uiLog.debug('PREVIEW', 'Iframe load event or completion detected');
                setTimeout(doSetup, 300);
            };

            previewState.previewIframe.onload = onIframeLoad;

            doc.write('<!DOCTYPE html>' + html);
            doc.close();

            // Extra safety for Safari: if the document is already parsed, fire doSetup
            if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
                setTimeout(onIframeLoad, 500);
            }
            try {
                const theme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('app_theme') || 'dark';
                if (doc && doc.documentElement) doc.documentElement.setAttribute('data-theme', theme);
            } catch (e) {
                // ignore
            }
            uiLog.debug('PREVIEW', 'Preview iframe updated with final HTML');
        }

        // Try to detect if already loaded (sync srcdoc or manual write)
        const doc = previewState.previewIframe.contentDocument;
        if (doc && doc.readyState === 'complete' && findSlides(doc).length > 0) {
            setTimeout(doSetup, 50);
        }

        // Fallback: poll until slides appear in the DOM (handles slow CDN or missed onload)
        let attempts = 0;
        const poll = () => {
            if (setupDone) return;
            attempts++;
            const doc = previewState.previewIframe.contentDocument;
            if (doc && doc.body) {
                const found = findSlides(doc);
                if (found.length >= 1) {
                    doSetup();
                    return;
                }
            }
            if (attempts < 40) {
                setTimeout(poll, 250); // retry every 250ms, up to 10s
            } else {
                uiLog.warn('PREVIEW', 'Slide polling exhausted, activating fallback setup', {
                    attempts
                });
                // Force-complete setup even if slides aren't found yet
                // (avoids hanging forever if the HTML has an unexpected structure).
                if (!setupDone) {
                    setupDone = true;
                    setupPreviewInteractions();
                    if (typeof callback === 'function') callback();
                }
            }
        };
        setTimeout(poll, 300);
    }

    const findSlides = window.AedosPreview.createSlideDiscovery();

    const previewUiState = {
        minimapAlreadyInit: false,
        toolsAlreadyInit: false,
        skipMinimapSkeleton: false
    };
    // True during soft-regen streaming: blocks updateMinimapSkeleton so the existing
    // real thumbnails stay visible (instead of being cleared and replaced by skeleton items
    // the moment skeleton-injector fires its first postMessage).
    const { setupPreviewInteractions, syncZoomStateWithViewportMode, updateZoomDisplay } = window.AedosPreview.createPreviewInteractions({
        getDeps: () => ({ previewState, previewUiState, previewHeader, uiLog, handleSlideWheelNav, handleTouchStart, handleTouchEnd, injectImageReplacementSystem, scrollToSlide, updateSlideCounter, buildDots, scaleIframe, updateMinimapSkeleton, isMobileViewport, findSlides, getRefreshSlotOverlays: () => _refreshSlotOverlays, getOverlayMap: () => _overlayMap, getBuildOverlayForSlot: () => _buildOverlayForSlot, getStabilizeMinimapOnNextPreviewInit: () => _stabilizeMinimapOnNextPreviewInit, setStabilizeMinimapOnNextPreviewInit: (value) => { _stabilizeMinimapOnNextPreviewInit = value; } }),
        MOBILE_BREAKPOINT,
        resetMobileZoomState
    });

    const { scaleIframe, handleFullscreenChange } = window.AedosPreview.createIframeScale({ previewState, previewContainer, syncZoomStateWithViewportMode, updateZoomDisplay, clearStageInlinePadding, getRefreshSlotOverlays: () => _refreshSlotOverlays });
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

    function updateMinimapSkeleton(count) {
        const minimapList = document.getElementById('minimap-list');
        if (!minimapList) return;

        let currentCount = minimapList.querySelectorAll('.minimap-item').length;
        if (currentCount === count) return;

        if (count < currentCount || currentCount === 0) {
            minimapList.innerHTML = '';
            currentCount = 0;
            const mmContainer = document.getElementById('editor-minimap');
            if (mmContainer) {
                mmContainer.style.removeProperty('--presentation-accent');
                mmContainer.style.removeProperty('--accent');
            }
        }

        for (let i = currentCount; i < count; i++) {
            const item = document.createElement('div');
            item.className = 'minimap-item skeleton' + (i === count - 1 ? ' active' : '');

            const thumb = document.createElement('div');
            thumb.className = 'minimap-thumb-skeleton';

            const num = document.createElement('div');
            num.className = 'minimap-item-number';
            num.textContent = i + 1;

            item.appendChild(thumb);
            item.appendChild(num);
            minimapList.appendChild(item);
        }

        const items = minimapList.querySelectorAll('.minimap-item');
        items.forEach((it, idx) => {
            it.classList.toggle('active', idx === count - 1);
        });

        const minimapContainer = document.getElementById('editor-minimap');
        if (minimapContainer && items.length > 0) {
            const panelHeight = minimapContainer.clientHeight;
            const activeIdx = count - 1;

            // Fixed ITEM_HEIGHT matching layout space: 94.25 (item+border) + 6 (margin) = 100.25
            const ITEM_HEIGHT = 100.25;

            // Centering logic with 20px extra compensation for the list's padding-top
            const offset = (panelHeight / 2) - (activeIdx * ITEM_HEIGHT) - (ITEM_HEIGHT / 2) - 20;

            // Fast transition during streaming to match preview
            minimapList.style.transition = 'transform 0.8s cubic-bezier(0.25, 1, 0.5, 1)';
            minimapList.style.transform = `translateY(${offset}px)`;
        }
    }



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

    // =========================================================
    // DESELECT ON CLICK OUTSIDE PREVIEW
    // =========================================================
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
                    } catch (err) { }
                }
            }
        }
    });

    // Global helper for chips
    window.fillInput = (keyOrText) => {
        const input = document.getElementById('w-tema');
        if (input) {
            // Use translation if key exists, otherwise use as literal
            const translated = (typeof window.__t === 'function')
                ? window.__t(keyOrText)
                : keyOrText;
            // Prompts can come from i18n strings with HTML entities (&apos;, &amp;, etc.).
            // Decode them before writing to textarea value.
            const entityDecoder = document.createElement('textarea');
            entityDecoder.innerHTML = translated;
            input.value = entityDecoder.value;
            input.focus();
            input.dispatchEvent(new Event('input'));
        }
    };

    // Scroll is now native; no custom scroll-loop system
});

// -- Suggestion Pills Logic ---------------------------------------------------
document.querySelectorAll('.suggestion-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        const temaInput = document.getElementById('w-tema');
        if (temaInput) {
            const key = pill.dataset.topicKey;
            temaInput.value = key ? window.__t(key, pill.dataset.topic || '') : (pill.dataset.topic || '');
            temaInput.focus();
            const event = new Event('input', { bubbles: true });
            temaInput.dispatchEvent(event);
        }
    });
});
