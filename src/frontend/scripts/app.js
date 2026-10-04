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
    let debugLastGeneratedBtn = null; // Created dynamically in dev only

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

    // ── Dropdown Menus Logic (Mode & Language) ──────────────────────────────────
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

    function closeAllDropdowns() {
        if (modeMenu) modeMenu.classList.add('hidden');
        if (langMenu) langMenu.classList.add('hidden');
        if (exportMenu) exportMenu.classList.add('hidden');
        if (modeBtn) modeBtn.setAttribute('aria-expanded', 'false');
        if (langBtn) langBtn.setAttribute('aria-expanded', 'false');
        if (exportMenuBtn) exportMenuBtn.setAttribute('aria-expanded', 'false');
    }

    if (modeBtn && modeMenu) {
        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (modeBtn.disabled) return;
            const isHidden = modeMenu.classList.contains('hidden');
            closeAllDropdowns();
            if (isHidden) {
                modeMenu.classList.remove('hidden');
                modeBtn.setAttribute('aria-expanded', 'true');
            }
        });

        modeMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.dropdown-item[data-mode]');
            if (!item) return;
            const mode = item.dataset.mode;
            generationState.proModeEnabled = (mode === 'pro');

            modeMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');

            const labelKey = mode === 'pro' ? 'mode_pro_title' : 'mode_flash_title';
            if (currentModeLabel) {
                currentModeLabel.textContent = window.__t(labelKey);
                currentModeLabel.setAttribute('data-i18n', labelKey);
            }
            if (chatInputWrapper) chatInputWrapper.classList.toggle('is-pro', generationState.proModeEnabled);
            closeAllDropdowns();
        });
    }

    if (langBtn && langMenu) {
        langBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = langMenu.classList.contains('hidden');
            closeAllDropdowns();
            if (isHidden) {
                langMenu.classList.remove('hidden');
                langBtn.setAttribute('aria-expanded', 'true');
            }
        });

        langMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.dropdown-item[data-lang]');
            if (!item) return;
            generationState.targetLanguage = item.dataset.lang;

            langMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');

            if (currentLangLabel) currentLangLabel.textContent = item.textContent.split(' ')[0]; // Show shortened name if space exists
            closeAllDropdowns();
        });
    }

    if (exportMenuBtn && exportMenu) {
        exportMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = exportMenu.classList.contains('hidden');
            closeAllDropdowns();
            if (isHidden) {
                exportMenu.classList.remove('hidden');
                exportMenuBtn.setAttribute('aria-expanded', 'true');
            }
        });

        exportMenu.addEventListener('click', (e) => {
            if (e.target.closest('#finalize-btn')) {
                closeAllDropdowns();
            }
        });

        if (exportPptxBtn) {
            exportPptxBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (finalizeBtn && finalizeBtn.disabled) return;
                generationState.requestedExportFormat = 'pptx';
                closeAllDropdowns();
                finalizeBtn?.click();
            });
        }
    }

    document.addEventListener('click', closeAllDropdowns);

    // Auto-lock pro mode when files are attached
    window._syncModeWithFiles = function () {
        if (!modeBtn) return;
        if (window._attachedFiles && window._attachedFiles.length > 0) {
            generationState.proModeEnabled = true;
            modeBtn.disabled = true;
            modeBtn.style.opacity = '0.6';
            modeBtn.style.cursor = 'not-allowed';
            modeBtn.parentElement.setAttribute('data-tooltip', window.__t('mode_tooltip_file_locked', 'High Quality is required to analyze files.'));
            if (currentModeLabel) currentModeLabel.textContent = window.__t('mode_pro_title', 'High Quality');
            if (chatInputWrapper) chatInputWrapper.classList.add('is-pro');
            if (modeMenu) modeMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('active', el.dataset.mode === 'pro'));
        } else {
            generationState.proModeEnabled = false;
            modeBtn.disabled = false;
            modeBtn.style.opacity = '';
            modeBtn.style.cursor = '';
            modeBtn.parentElement.removeAttribute('data-tooltip');
            if (currentModeLabel) currentModeLabel.textContent = window.__t('mode_flash_title', 'Fast Mode');
            if (chatInputWrapper) chatInputWrapper.classList.remove('is-pro');
            if (modeMenu) modeMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('active', el.dataset.mode === 'flash'));
        }
    };
    // ─────────────────────────────────────────────────────────────────────

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

    // =========================================================
    // STATE ROUTER
    // =========================================================
    window.navigateToHome = function() {
        // Invalidate any queued slide messages/callbacks before tearing down
        // the current preview. This is the equivalent of unmount cleanup for
        // the vanilla iframe-based editor.
        generationState.activeGeneration = null;
        _pendingTransitionFn = null;

        if (window.location.hash !== '#home') {
            window.history.replaceState(null, '', '#home');
        }
        
        const chatScreen = document.getElementById('chat-screen');
        if (chatScreen) {
            chatScreen.classList.remove('chat-mode');
            chatScreen.classList.remove('hidden');
            chatScreen.style.cssText = '';
        }
        
        const heroZone = document.getElementById('hero-zone');
        if (heroZone) heroZone.classList.remove('fade-out');
        
        const pills = document.getElementById('suggestion-pills-row');
        if (pills) { pills.style.transition = ''; pills.style.opacity = '1'; pills.style.pointerEvents = 'auto'; }
        const microcopy = document.querySelector('.app-microcopy');
        if (microcopy) { microcopy.style.transition = ''; microcopy.style.opacity = '1'; }
        const counter = document.querySelector('.chat-counter-row');
        if (counter) { counter.style.transition = ''; counter.style.opacity = '1'; }
        
        const convZone = document.getElementById('conversation-zone');
        if (convZone) {
            convZone.classList.add('hidden');
            convZone.classList.remove('visible');
            
            // 1. Move outline-container back to its original home inside #chat-ai-response .chat-ai-body and hide it
            const outlineContainer = document.getElementById('outline-container');
            const originalAiBody = document.querySelector('#chat-ai-response .chat-ai-body');
            if (outlineContainer && originalAiBody) {
                outlineContainer.classList.add('hidden');
                originalAiBody.appendChild(outlineContainer);
            }

            // 2. Remove any dynamically added follow-up bubbles, but keep the first two hardcoded ones safe
            const dynamicBubbles = convZone.querySelectorAll('.chat-msg:not(#chat-user-bubble):not(#chat-ai-response)');
            dynamicBubbles.forEach(b => b.remove());
            const dynamicErrors = convZone.querySelectorAll('.chat-error-message');
            dynamicErrors.forEach(e => e.remove());

            // 3. Clean up any historical outline summaries anywhere in the chat
            convZone.querySelectorAll('.historical-outline-summary').forEach(el => el.remove());

            // 4. Reset outline slides container and chips to pristine empty state
            const slidesContainer = document.getElementById('outline-slides-container');
            if (slidesContainer) slidesContainer.innerHTML = '';
            const chipsContainer = document.getElementById('outline-suggested-chips');
            if (chipsContainer) {
                chipsContainer.innerHTML = '';
                if (window._chipsRenderTimeout) clearTimeout(window._chipsRenderTimeout);
            }

            // 5. Clean up the first two hardcoded bubbles to their pristine starting state
            const firstUserText = document.getElementById('chat-user-text');
            if (firstUserText) firstUserText.textContent = '';

            const firstAiResponse = document.getElementById('chat-ai-response');
            if (firstAiResponse) {
                // Restore default classes
                firstAiResponse.className = 'chat-msg chat-msg-ai';
                
                // Clean up any proceed, cancelled or error elements
                firstAiResponse.querySelectorAll('.chat-proceed-message, .chat-cancelled-message, .chat-error-message').forEach(el => el.remove());
                
                // Reset thinking dots
                const thinking = firstAiResponse.querySelector('.chat-thinking');
                if (thinking) {
                    thinking.className = 'chat-thinking hidden';
                }
                
                // Restore avatar opacity
                const avatar = firstAiResponse.querySelector('.chat-ai-avatar');
                if (avatar) {
                    avatar.style.opacity = '';
                    avatar.style.pointerEvents = '';
                    avatar.style.userSelect = '';
                }
            }
        }
        
        // 6. Reset local attached files state and UI
        if (window._attachedFiles) {
            window._attachedFiles = [];
            const attachmentPreview = document.getElementById('attachment-preview-container');
            if (attachmentPreview) {
                attachmentPreview.innerHTML = '';
                attachmentPreview.classList.add('hidden');
            }
            const modeBtn = document.getElementById('btn-mode-dropdown');
            if (modeBtn) {
                modeBtn.disabled = false;
                modeBtn.style.opacity = '';
                modeBtn.style.cursor = '';
                if (modeBtn.parentElement) {
                    modeBtn.parentElement.removeAttribute('data-tooltip');
                }
            }
        }
        
        if (window.outlineEditorState && window.AedosStores && window.AedosStores.outline) {
            window.AedosStores.outline.clearDraft();
        }
        
        const previewCont = document.getElementById('preview-container');
        if (previewCont) {
            previewCont.classList.add('hidden');
        }
        
        const temaInput = document.getElementById('w-tema');
        if (temaInput) temaInput.value = '';

        // Reset hero custom state and title text upon returning home
        generationState.heroCustomTextActive = false;
        const heroTextSpan = document.querySelector('.hero-title-text');
        if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
            heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
            heroTextSpan.parentElement.classList.remove('waiting-state');
        }
    };

    window.navigateToChat = function() {
        if (window.location.hash !== '#chat') {
            window.history.pushState(null, '', '#chat');
        }
        // Let existing chat initialization (outline.js) handle specific DOM changes
    };

    window.navigateToEditor = function() {
        if (window.location.hash !== '#editor') {
            window.history.pushState(null, '', '#editor');
        }
        // Specific changes handled organically by startFinalGeneration
    };

    // Handle browser back/forward button natively via Router
    window.addEventListener('popstate', (e) => {
        const hash = window.location.hash;
        
        const previewCont = document.getElementById('preview-container');
        const outlineContainer = document.getElementById('outline-container');

        // Check if there is active progress that can be lost (generation OR manual editing)
        const outlineActive = !!generationState.skeletonController || (outlineContainer && !outlineContainer.classList.contains('hidden'));
        const editorActive = !!generationState.activeController || (previewCont && !previewCont.classList.contains('hidden'));

        if (outlineActive || editorActive) {
            const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
            if (confirm(msg)) {
                if (outlineContainer) outlineContainer.classList.add('hidden'); 
                if (previewCont) previewCont.classList.add('hidden'); 
                
                if (generationState.activeController) { generationState.activeController.abort(); generationState.activeController = null; }
                if (generationState.skeletonController) { generationState.skeletonController.abort(); generationState.skeletonController = null; }
                
                // Reset hash to #home and reload to guarantee a clean URL
                window.location.href = window.location.origin + window.location.pathname + '#home';
            } else {
                // User cancelled, restore URL hash corresponding to their active state
                // If the preview container is visible, they are in the editor (#editor)
                // Otherwise they are in the outline editor or slide loading screen (#chat)
                const editorVisible = previewCont && !previewCont.classList.contains('hidden');
                if (editorVisible) {
                    window.history.replaceState(null, '', '#editor');
                } else {
                    window.history.replaceState(null, '', '#chat');
                }
                return; // Stop processing popstate
            }
        }
        
        // Standard Router Fallback (if no active progress is at risk)
        if (hash === '' || hash === '#home') {
            window.navigateToHome();
        } else if (hash === '#chat') {
            // As per user requirement: if the user navigates back to the chat from the editor,
            // they should be returned to the menu to avoid getting stuck in the "creating slides" state.
            window.navigateToHome();
        }
    });

    // Always force redirect to #home on fresh reload or entry
    const initialHash = window.location.hash;
    if (initialHash !== '#home') {
        window.history.replaceState(null, '', '#home');
    }
    window.navigateToHome();

    // Click brand logo to go to #home with progress warning checks
    const topBrand = document.querySelector('.top-brand');
    if (topBrand) {
        topBrand.addEventListener('click', () => {
            const previewCont = document.getElementById('preview-container');
            const outlineContainer = document.getElementById('outline-container');
            const outlineActive = !!generationState.skeletonController || (outlineContainer && !outlineContainer.classList.contains('hidden'));
            const editorActive = !!generationState.activeController || (previewCont && !previewCont.classList.contains('hidden'));

            if (outlineActive || editorActive) {
                const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
                if (!confirm(msg)) {
                    return; // user cancelled, do not navigate
                }
                
                // If confirmed, reset states
                if (outlineContainer) outlineContainer.classList.add('hidden'); 
                if (previewCont) previewCont.classList.add('hidden'); 
                if (generationState.activeController) { generationState.activeController.abort(); generationState.activeController = null; }
                if (generationState.skeletonController) { generationState.skeletonController.abort(); generationState.skeletonController = null; }
            }

            // Cleanly reset UI and set hash to #home
            window.navigateToHome();
        });
    }

    // Warn on tab close if the user has active draft progress (generation OR manual editing)
    window.addEventListener('beforeunload', (e) => {
        const outlineContainer = document.getElementById('outline-container');
        const previewCont = document.getElementById('preview-container');
        
        const outlineActive = !!generationState.skeletonController || (outlineContainer && !outlineContainer.classList.contains('hidden'));
        const editorActive = !!generationState.activeController || (previewCont && !previewCont.classList.contains('hidden'));

        if (outlineActive || editorActive) {
            e.preventDefault();
            e.returnValue = ''; // Standard way to trigger native browser prompt
        }
    });

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


    chatState.warmedUp = false;
    temaInput.addEventListener('input', () => {
        const val = temaInput.value;

        // Warm up the backend if not already done
        if (!chatState.warmedUp && val.length > 0) {
            chatState.warmedUp = true;
            fetch('/health').catch(() => {
                // Silently fail, allow retry on next input if it failed
                chatState.warmedUp = false;
            });
        }

        // Scroll to top if user starts typing while scrolled down
        if (window.scrollY > 200) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Auto-resize vertical expansion
        temaInput.style.height = 'auto';
        temaInput.style.height = temaInput.scrollHeight + 'px';

        // Update character count
        const charCounter = document.getElementById('char-counter');
        if (charCounter) {
            const len = val.length;
            charCounter.textContent = `${len}/600`;
            if (len > 0) {
                charCounter.classList.add('visible');
            } else {
                charCounter.classList.remove('visible');
            }

            if (len > 550) {
                charCounter.style.color = '#ff5b5b'; // Red when approaching 600
            } else {
                charCounter.style.color = 'var(--muted)';
            }
        }

        if (val.length > 0) {
            temaError.classList.remove('visible');
        }

        validateGenerateButton();
    });

    // Enter key to advance
    temaInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!btnGenerate.disabled) {
                btnGenerate.click();
            }
        }
    });

    // Hide hero cursor on focus to avoid double-cursor visual overload (without layout shift)
    if (temaInput) {
        const heroCursor = document.querySelector('.hero-cursor');
        if (heroCursor) {
            // Check immediately on startup in case of browser autofocus
            if (document.activeElement === temaInput) {
                heroCursor.style.visibility = 'hidden';
            }

            temaInput.addEventListener('focus', () => {
                heroCursor.style.visibility = 'hidden';
            });
            temaInput.addEventListener('blur', () => {
                heroCursor.style.visibility = 'visible';
            });
        }
    }



    // =========================================================
    // 5. GENERATE BUTTON
    // =========================================================
    const generateBtn = document.getElementById('btn-generate');



    // ── Button cycling message state ──────────────────────────────────────
    chatState.BTN_LOADING_KEYS_DESKTOP = [
        'gen_loading_1', 'gen_loading_2', 'gen_loading_3', 'gen_loading_4',
        'gen_loading_5', 'gen_loading_6', 'gen_loading_7', 'gen_loading_8',
        'gen_loading_9', 'gen_loading_final'
    ];
    chatState.activeBtnLoadingKeys = chatState.BTN_LOADING_KEYS_DESKTOP;
    chatState.btnMsgTimer = null;
    chatState.btnMsgIndex = 0;

    function _resolveBtnLoadingKeys() {
        if (window.MobileRuntime && typeof window.MobileRuntime.resolveLoadingKeys === 'function') {
            return window.MobileRuntime.resolveLoadingKeys(chatState.BTN_LOADING_KEYS_DESKTOP);
        }
        if (window.innerWidth <= 768) {
            return chatState.BTN_LOADING_KEYS_DESKTOP.map(key => key + '_mobile');
        }
        return chatState.BTN_LOADING_KEYS_DESKTOP;
    }

    function _scheduleNextBtnMsg() {
        if (chatState.btnMsgIndex >= chatState.activeBtnLoadingKeys.length - 1) return;
        chatState.btnMsgTimer = setTimeout(() => {
            chatState.btnMsgIndex++;
            const key = chatState.activeBtnLoadingKeys[chatState.btnMsgIndex];
            const fallbackKey = chatState.BTN_LOADING_KEYS_DESKTOP[chatState.btnMsgIndex] || 'gen_loading_final';
            const newText = window.__t(key, window.__t(fallbackKey));
            animateHeroTitle(newText);
            _scheduleNextBtnMsg();
        }, 3000); // Increased interval slightly to account for animations
    }

    function animateHeroTitle(newText) {
        const heroTextSpan = document.querySelector('.hero-title-text');
        const heroTitle = document.querySelector('.hero-title');
        if (!heroTextSpan || !heroTitle) return;
        const clean = newText.replace(/\.+$/, '').trimEnd();

        if (window._heroTypewriterTimer) {
            clearTimeout(window._heroTypewriterTimer);
            window._heroTypewriterTimer = null;
        }
        if (window.gsap) window.gsap.killTweensOf(heroTitle);

        // Fast fade out from right to left (moving left while fading)
        gsap.to(heroTitle, {
            x: -20,
            opacity: 0,
            duration: 0.45,
            ease: "power2.in",
            onComplete: () => {
                heroTextSpan.textContent = '';
                gsap.set(heroTitle, { x: 0, opacity: 1 });

                // Manual typewriter effect
                let i = 0;
                function typeChar() {
                    if (i < clean.length) {
                        heroTextSpan.textContent += clean.charAt(i);
                        i++;
                        window._heroTypewriterTimer = setTimeout(typeChar, 28);
                    }
                }
                typeChar();
            }
        });
    }

    chatState.heroResetTimer = null;
    function startBtnMessages() {
        if (chatState.heroResetTimer) { clearTimeout(chatState.heroResetTimer); chatState.heroResetTimer = null; }
        chatState.activeBtnLoadingKeys = _resolveBtnLoadingKeys();
        chatState.btnMsgIndex = 0;
        chatState.btnMsgTimer = null;
        const key = chatState.activeBtnLoadingKeys[0];
        const newText = window.__t(key, window.__t(chatState.BTN_LOADING_KEYS_DESKTOP[0]));
        animateHeroTitle(newText);
        _scheduleNextBtnMsg();
    }

    function pauseBtnMessages() {
        if (chatState.btnMsgTimer) { clearTimeout(chatState.btnMsgTimer); chatState.btnMsgTimer = null; }
    }

    function resumeBtnMessages() {
        if (!chatState.btnMsgTimer) _scheduleNextBtnMsg();
    }

    function stopBtnMessages() {
        pauseBtnMessages();
        chatState.btnMsgIndex = 0;
        if (chatState.heroResetTimer) clearTimeout(chatState.heroResetTimer);
        chatState.heroResetTimer = setTimeout(() => {
            animateHeroTitle(window.__t('hero_line_1', 'Got a spicy idea?'));
            chatState.heroResetTimer = null;
        }, 3000);
    }
    // ─────────────────────────────────────────────────────────────────────

    function toggleGenerateLoading(isLoading) {
        const editorControls = [
            ...Array.from(document.querySelectorAll('.preview-unified-header button, .preview-unified-header select, .preview-unified-header input')),
            ...Array.from(document.querySelectorAll('#editor-tools-panel button, #editor-tools-panel select, #editor-tools-panel input, #editor-minimap button'))
        ];

        if (isLoading) {
            // Keep temaInput enabled so user can write while generating
            if (temaInput) temaInput.disabled = false;

            // Keep generateBtn enabled and flag it as active generation (so it acts as stop button)
            if (generateBtn) {
                generateBtn.classList.add('is-generating');
                generateBtn.disabled = false;
            }
            if (typeof modeBtn !== 'undefined' && modeBtn) modeBtn.disabled = true;
            if (typeof langBtn !== 'undefined' && langBtn) langBtn.disabled = true;
            if (typeof btnAttachFile !== 'undefined' && btnAttachFile) btnAttachFile.disabled = true;

            stopTypewriter();
            startBtnMessages();

            document.querySelectorAll('.suggestion-pill, .file-chip-remove').forEach(el => el.disabled = true);

            // Disable editor buttons/controls during generation
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = true; });
        } else {
            // Force hide all thinking loaders in the DOM when loading stops
            document.querySelectorAll('.chat-thinking').forEach(el => el.classList.add('hidden'));

            if (temaInput) temaInput.disabled = false;

            if (generateBtn) {
                generateBtn.classList.remove('is-generating');
            }
            if (typeof validateGenerateButton === 'function') validateGenerateButton();
            if (typeof modeBtn !== 'undefined' && modeBtn) { if (!window._attachedFiles || window._attachedFiles.length === 0) modeBtn.disabled = false; }
            if (typeof langBtn !== 'undefined' && langBtn) langBtn.disabled = false;
            if (typeof btnAttachFile !== 'undefined' && btnAttachFile) btnAttachFile.disabled = false;

            if (chatState.typewriterCursor) chatState.typewriterCursor.style.display = '';
            stopBtnMessages();

            document.querySelectorAll('.suggestion-pill, .file-chip-remove').forEach(el => el.disabled = false);

            // Enable editor buttons/controls after generation (or error)
            editorControls.forEach(ctrl => { if (ctrl) ctrl.disabled = false; });

            // Native textarea placeholder handles empty state.
            if (typeof updateZoomDisplay === 'function') updateZoomDisplay();
        }
    }

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
        if (!html || typeof html !== 'string') return fallbackTitle;

        const configMatch = html.match(/<!--\s*CONFIG\s*([\s\S]*?)\s*-->/i);
        if (configMatch) {
            try {
                const configObj = JSON.parse(configMatch[1]);
                if (configObj.Clean_Topic) return configObj.Clean_Topic;
                if (configObj.topic) return configObj.topic;
            } catch (e) { }
        }

        const titleMatch = html.match(/<title>\s*(.*?)\s*<\/title>/i);
        if (titleMatch && titleMatch[1]) return titleMatch[1];

        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match && h1Match[1]) {
            const cleanTitle = h1Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanTitle) return cleanTitle;
        }

        return fallbackTitle;
    }

    function openPreviewFromExistingHtml(html, title) {
        if (!html || typeof html !== 'string') {
            throw new Error('Debug HTML is empty or invalid.');
        }

        // Set the hash to #editor so back button and warnings work flawlessly in debug mode
        if (window.location.hash !== '#editor') {
            window.navigateToEditor();
        }

        previewState.generatedHtml = html;
        previewState.currentSlide = 0;
        previewState.totalSlides = 0;
        window.currentSlide = 0;
        previewState.currentTitle = title;
        _pendingTransitionFn = null;
        window._manualZoomScale = 1;
        updateZoomDisplay();

        if (resultContainer) resultContainer.classList.add('hidden');
        if (errorContainer) errorContainer.classList.add('hidden');
        if (refusedContainer) refusedContainer.classList.add('hidden');

        previewContainer.classList.remove('hidden', 'is-generating', 'is-settling', 'is-editor-ready', 'reveal-sequence', 'reveal-minimap', 'reveal-tools', 'reveal-chrome');
        chatScreen.style.cssText = '';
        chatScreen.classList.add('hidden');
        document.body.classList.add('no-scroll');

        resetPreviewSurface();
        setPreviewTitle(title);

        slideLabel.textContent = '1 / 1';
        updateMinimapSkeleton(1);

        previewHeader.classList.remove('slide-down');
        initPreview(html, () => {
            previewContainer.classList.remove('is-generating', 'is-settling', 'is-editor-ready', 'reveal-sequence', 'reveal-minimap', 'reveal-tools');
            previewHeader.classList.add('slide-down');
            // Apply settled insets so the slide centers between panels in debug mode.
            if (window.innerWidth > 768) {
                previewState.editorInsets = { left: 165, right: 30, top: 64, bottom: 64 };
                const dbgStage = document.getElementById('preview-stage');
                if (dbgStage) {
                    dbgStage.style.paddingLeft = '165px';
                    dbgStage.style.paddingRight = '30px';
                    dbgStage.style.paddingTop = '64px';
                    dbgStage.style.paddingBottom = '64px';
                }
            }
            previewContainer.classList.add('is-editor-ready');
            scaleIframe();
        });
    }

    async function openLastGeneratedDebugCanvas() {
        if (debugLastGeneratedBtn) debugLastGeneratedBtn.disabled = true;

        try {
            const response = await fetch('/__dev__/last-generated', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error('No debug HTML available in tmp/last_generated.html.');
            }

            const html = await response.text();
            const title = extractPreviewTitleFromHtml(html, 'Debug Canvas');
            openPreviewFromExistingHtml(html, title);
        } catch (error) {
            if (previewContainer) previewContainer.classList.add('hidden');
            if (chatScreen) {
                chatScreen.style.cssText = '';
                chatScreen.classList.remove('hidden');
            }
            if (errorMessage) errorMessage.textContent = error.message;
            if (errorContainer) showErrorModal(() => resetUI());
            document.body.classList.remove('no-scroll');
        } finally {
            if (debugLastGeneratedBtn) debugLastGeneratedBtn.disabled = false;
        }
    }

    async function setupDevelopmentDebugMode() {
        // Only run on localhost — never inject anything in production
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!isLocal) return;

        try {
            const response = await fetch('/__dev__/last-generated', { method: 'HEAD', cache: 'no-store' });
            if (!response.ok) return;

            // Create the button dynamically so it never ships in the production HTML
            debugLastGeneratedBtn = document.createElement('button');
            debugLastGeneratedBtn.type = 'button';
            debugLastGeneratedBtn.id = 'btn-debug-last-generated';
            debugLastGeneratedBtn.className = 'action-icon-btn';
            debugLastGeneratedBtn.title = 'Load last generated HTML (Dev only)';
            debugLastGeneratedBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>`;

            // Insert before the attach-file button
            const btnAttachFileEl = document.getElementById('btn-attach-file');
            if (btnAttachFileEl) {
                btnAttachFileEl.parentElement.insertBefore(debugLastGeneratedBtn, btnAttachFileEl);
            }

            debugLastGeneratedBtn.addEventListener('click', () => openLastGeneratedDebugCanvas());

            const params = new URLSearchParams(window.location.search);
            if (params.get('debug') === 'last') {
                openLastGeneratedDebugCanvas();
            }
        } catch (error) {
            // Endpoint unavailable — silently skip
        }
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
        function doTransitionToPreview() {
            if (_hasTransitioned) return;
            if (generationState.activeGeneration !== generation || generation.finalPreviewMounted) return;
            _hasTransitioned = true;
            generation.transitionStarted = true;
            stopBtnMessages();

            // Only transition the URL to #editor now that the editor has actually loaded!
            if (window.location.hash !== '#editor') {
                window.navigateToEditor();
            }

            // Clean up split outline layout and reset hero
            document.body.classList.remove('split-outline-active');
            const btnOutlineGenerate = document.getElementById('btn-outline-generate');
            if (btnOutlineGenerate) {
                btnOutlineGenerate.classList.remove('is-generating');
            }
            const heroTextSpan = document.querySelector('.hero-title-text');
            if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
                heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
                heroTextSpan.parentElement.classList.remove('waiting-state');
            }

            // Fade chat screen out (it's covered by fixed preview-container, but still clean)
            chatScreen.style.cssText = 'opacity:0;transition:opacity 0.35s ease;pointer-events:none;';
            setTimeout(() => {
                chatScreen.classList.add('hidden');
                chatScreen.style.cssText = '';
            }, 380);
            // Reveal preview (sectionFadeIn animation kicks in automatically)
            previewHeader.classList.remove('slide-down');
            previewContainer.classList.remove('hidden', 'reveal-chrome', 'reveal-sequence', 'reveal-minimap', 'reveal-tools', 'is-editor-ready');
            previewContainer.classList.add('is-generating');
            document.body.classList.add('no-scroll');

            // Kill any in-progress settling tween from a previous generation so its
            // onComplete never fires showFloatingPills during the new streaming session.
            if (previewState.settlingAnimation) { previewState.settlingAnimation.kill(); previewState.settlingAnimation = null; }

            // Reset panel insets so slide fills the full screen during streaming.
            previewState.editorInsets = { left: 0, right: 0, top: 0, bottom: 0 };
            resetMobileZoomState();
            window._manualZoomScale = 1;
            updateZoomDisplay();
            const _scrollableReset = document.getElementById('preview-wrapper-scrollable');
            if (_scrollableReset) _scrollableReset.style.transform = '';
            // Clear any leftover inline stage padding from the previous settling animation
            // (CSS `is-generating .preview-stage { padding:0 !important }` also covers this).
            clearStageInlinePadding();

            // Double-rAF: the first rAF triggers style recalculation after display:none→flex;
            // the second rAF fires after layout is fully computed so getBoundingClientRect
            // returns accurate dimensions.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                scaleIframe();
                // Extra safety: call once more after 300ms in case the iframe resizes on load.
                setTimeout(scaleIframe, 300);
            }));
            window.addEventListener('resize', scaleIframe);
        }

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

            uiLog.error('GENERATION', 'Presentation generation failed', { error });

            const errTitle = document.getElementById('t-error-title');
            const errSubtitle = document.getElementById('t-error-subtitle');

            // Default titles/subtitles
            if (errTitle) errTitle.textContent = window.__t ? window.__t('error_title', "Something didn't go as planned") : "Something didn't go as planned";
            if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('error_subtitle', "The AI service is temporarily unavailable. This is usually resolved quickly.") : "The AI service is temporarily unavailable. This is usually resolved quickly.";

            const rawMsg = error.message || '';
            const retryAfterMatch = rawMsg.match(/\|RETRY_AFTER=(\d+)/);
            const retryAfterSec = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) : null;
            const msg = rawMsg.replace(/\|RETRY_AFTER=\d+/, '');

            if (msg.includes('DAILY_LIMIT_EXCEEDED_FLASH') || msg.includes('DAILY_LIMIT_EXCEEDED_PRO') || msg.includes('DAILY_LIMIT_EXCEEDED_CHAT')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('daily_limit_title', "You've reached today's limit") : "You've reached today's limit";
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('daily_limit_msg', "Free generations reset every 24 hours. Come back tomorrow or try again later.") : "Free generations reset every 24 hours. Come back tomorrow or try again later.";
            } else if (msg.includes('COOLDOWN_ACTIVE')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('cooldown_title', "Wait a moment") : "Wait a moment";
                if (errSubtitle) {
                    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
                        const tpl = window.__t
                            ? window.__t('cooldown_msg_with_seconds', "Please wait {sec}s before generating again.")
                            : "Please wait {sec}s before generating again.";
                        errSubtitle.textContent = tpl.replace('{sec}', String(retryAfterSec));
                    } else {
                        errSubtitle.textContent = window.__t ? window.__t('cooldown_msg', "Please wait at least one minute between generations.") : "Please wait at least one minute between generations.";
                    }
                }
            } else if (msg.includes('GLOBAL_DAILY_LIMIT_EXCEEDED')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('global_daily_limit_title', "Today's global capacity was reached") : "Today's global capacity was reached";
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('global_daily_limit_msg', "The system reached its daily generation capacity. Please try again tomorrow.") : "The system reached its daily generation capacity. Please try again tomorrow.";
            } else if (msg.includes('QUEUE_FULL')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('queue_full_title', "Queue is full right now") : "Queue is full right now";
                if (errSubtitle) {
                    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
                        const tpl = window.__t
                            ? window.__t('queue_full_msg_with_seconds', "Too many simultaneous requests. Try again in {sec}s.")
                            : "Too many simultaneous requests. Try again in {sec}s.";
                        errSubtitle.textContent = tpl.replace('{sec}', String(retryAfterSec));
                    } else {
                        errSubtitle.textContent = window.__t ? window.__t('queue_full_msg', "Too many simultaneous requests. Try again in a few seconds.") : "Too many simultaneous requests. Try again in a few seconds.";
                    }
                }
            } else if (msg.includes('PRO_TEMPORARILY_PAUSED')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('pro_paused_title', "Pro mode is temporarily paused") : "Pro mode is temporarily paused";
                if (errSubtitle) {
                    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
                        const tpl = window.__t
                            ? window.__t('pro_paused_msg_with_seconds', "High load detected. Retry Pro mode in {sec}s or switch to Flash mode.")
                            : "High load detected. Retry Pro mode in {sec}s or switch to Flash mode.";
                        errSubtitle.textContent = tpl.replace('{sec}', String(retryAfterSec));
                    } else {
                        errSubtitle.textContent = window.__t ? window.__t('pro_paused_msg', "High load detected. Please retry Pro mode shortly or switch to Flash mode.") : "High load detected. Please retry Pro mode shortly or switch to Flash mode.";
                    }
                }
            } else if (msg.includes('RATE_LIMIT_EXCEEDED')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('rate_limit_title', "Slow down a bit") : "Slow down a bit";
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('rate_limit_msg', "Too many requests in a short time. Wait a few minutes and try again.") : "Too many requests in a short time. Wait a few minutes and try again.";
            } else if (msg.includes('TOPIC_TOO_LONG')) {
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('topic_too_long', "The topic is too long. Keep it under 600 characters.") : "The topic is too long. Keep it under 600 characters.";
            } else if (msg.includes('SKELETON_EMPTY')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('outline_empty_title', "Outline is empty") : "Outline is empty";
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('outline_empty_msg', "Please add at least one slide to your outline before generating.") : "Please add at least one slide to your outline before generating.";
            } else if (msg.includes('GENERATION_OUTPUT_TOO_LARGE')) {
                if (errTitle) errTitle.textContent = window.__t ? window.__t('generation_too_large_title', "The presentation is too large") : "The presentation is too large";
                if (errSubtitle) errSubtitle.textContent = window.__t ? window.__t('generation_too_large_msg', "Try fewer slides or a shorter description, then generate it again.") : "Try fewer slides or a shorter description, then generate it again.";
            } else {
                // Try to extract "Please retry in X seconds" from Gemini standard errors
                let retryMsg = "";
                const retryMatch = msg.match(/retry in ([\d\.]+)s/i);
                if (retryMatch) {
                    const seconds = Math.ceil(parseFloat(retryMatch[1]));
                    const timeStr = seconds >= 60
                        ? `${Math.ceil(seconds / 60)} min`
                        : `${seconds}s`;
                    const retryTpl = window.__t ? window.__t(window.currentLang === 'es' ? 'retry_in_es' : 'retry_in_en', "<br><br><strong>Retry in: {time}</strong>") : "<br><br><strong>Retry in: {time}</strong>";
                    retryMsg = retryTpl.replace('{time}', timeStr);
                }

                if (msg.includes('429') || msg.includes('503') || msg.toLowerCase().includes('exhausted') || msg.toLowerCase().includes('saturated')) {
                    if (errTitle) errTitle.textContent = window.__t ? window.__t('overloaded_title', "High demand right now") : "High demand right now";
                    if (errSubtitle) {
                        errSubtitle.innerHTML = (window.__t ? window.__t('t-error-saturated', "The service is a bit overwhelmed at the moment. Usually clears up in a few minutes.") : "The service is a bit overwhelmed at the moment. Usually clears up in a few minutes.") + retryMsg;
                    }
                }
            }


            errorMessage.textContent = msg;
            previewContainer.classList.remove('is-generating', 'is-settling', 'is-editor-ready', 'reveal-sequence', 'reveal-minimap', 'reveal-tools');

            // Clean up split outline layout and reset hero
            document.body.classList.remove('split-outline-active');
            const btnOutlineGenerate = document.getElementById('btn-outline-generate');
            if (btnOutlineGenerate) {
                btnOutlineGenerate.classList.remove('is-generating');
            }
            const heroTextSpan = document.querySelector('.hero-title-text');
            if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
                heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
                heroTextSpan.parentElement.classList.remove('waiting-state');
            }
            // Clean up infinite loader/spinner in the chat bubbles to prevent hanging states on rate-limits
            if (window._proceedMsgInterval) {
                clearInterval(window._proceedMsgInterval);
                window._proceedMsgInterval = null;
            }
            const activeProceedMsg = document.querySelector('.chat-proceed-message');
            if (activeProceedMsg) {
                activeProceedMsg.innerHTML = `<span style="color: var(--danger); font-size: 1.2rem; display: inline-block;">⚠</span> <span style="color: var(--danger); font-weight: 500;">${window.__t ? window.__t('generation_failed_chat', 'Generation failed') : 'Generation failed'}: ${msg}</span>`;
                if (window.gsap) {
                    window.gsap.fromTo(activeProceedMsg, { opacity: 0 }, { opacity: 1, duration: 0.3 });
                }
            }
            // Clean up dynamic thinking loading state in the latest active AI bubble
            const aiBubbles = document.querySelectorAll('.chat-msg-ai');
            const latestAiBubble = aiBubbles[aiBubbles.length - 1];
            if (latestAiBubble) {
                const thinking = latestAiBubble.querySelector('.chat-thinking');
                if (thinking) thinking.classList.add('hidden');
            } else {
                const thinking = document.getElementById('chat-thinking');
                if (thinking) thinking.classList.add('hidden');
            }

            const outlineContainer = document.getElementById('outline-container');
            // FIX: Do NOT hide outlineContainer, backdrop, and edgeTab here.
            // If the user gets rate-limited, they should be able to keep their draft and try again.
            // if (outlineContainer) outlineContainer.classList.add('hidden');
            // const backdrop = document.getElementById('outline-backdrop');
            // if (backdrop) backdrop.classList.remove('active');
            // const edgeTab = document.getElementById('outline-edge-tab');
            // if (edgeTab) edgeTab.classList.add('hidden');

            // Clean up any in-progress chat→preview transition
            if (!_hasTransitioned) {
                chatScreen.style.cssText = '';
                chatScreen.classList.remove('hidden');
            }
            iframeDoc.close();
            // Show error overlay on top of whatever is visible; dismiss → go to home
            showErrorModal(() => {
                window.navigateToHome();
            });
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
    setupDevelopmentDebugMode();



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

    function findSlides(doc) {
        if (!doc || !doc.body) return [];

        // Strategy 1: section.s (the expected format from our prompt)
        let slides = doc.querySelectorAll('section.s');
        if (slides.length >= 1) return Array.from(slides);

        // Strategy 2: sections with class containing "slide"
        slides = doc.querySelectorAll('section[class*="slide"]');
        if (slides.length >= 1) return Array.from(slides);

        // Strategy 3: leaf sections (sections that don't contain other sections)
        const allSections = Array.from(doc.querySelectorAll('section'));
        const leafSections = allSections.filter(s => !s.querySelector('section'));
        if (leafSections.length >= 1) return leafSections;
        if (allSections.length >= 1) return allSections;

        // Strategy 4: divs with slide-like classes
        let divSlides = doc.querySelectorAll('div.s, div.slide, div[class*="slide"]');
        if (divSlides.length >= 1) return Array.from(divSlides);

        // Strategy 5: direct body children (excluding script/style/link/meta AND editor UI)
        const bodyKids = Array.from(doc.body.children).filter(el => {
            const tag = el.tagName;
            const isTool = el.classList.contains('editor-selection-box') ||
                el.classList.contains('editor-toolbar') ||
                el.classList.contains('editor-guide') ||
                el.classList.contains('editor-color-picker');
            return !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(tag) && !isTool;
        });
        if (bodyKids.length >= 1) {
            // If there's only one kid and it contains slides, prefer its children (Strategy 6-like)
            if (bodyKids.length === 1) {
                const inner = Array.from(bodyKids[0].children).filter(el =>
                    !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)
                );
                if (inner.length >= 1) return inner;
            }
            return bodyKids;
        }

        return Array.from(slides); // fallback to whatever last matched
    }

    const previewUiState = {
        minimapAlreadyInit: false,
        toolsAlreadyInit: false,
        skipMinimapSkeleton: false
    };
    // True during soft-regen streaming: blocks updateMinimapSkeleton so the existing
    // real thumbnails stay visible (instead of being cleared and replaced by skeleton items
    // the moment skeleton-injector fires its first postMessage).
    function setupPreviewInteractions(targetIndex = 0) {
        const iframeDoc = previewState.previewIframe.contentDocument || previewState.previewIframe.contentWindow.document;
        if (!iframeDoc || !iframeDoc.body) return;

        // Images and web fonts can change slide geometry after the iframe load
        // event.  Initialize the carousel/editor only after the layout has had a
        // chance to settle; otherwise the first setup can measure zero-sized
        // slides and leave the editor apparently blank.
        const settlePreviewLayout = () => {
            const images = Array.from(iframeDoc.images || []);
            const imageLoads = images.map((image) => {
                if (image.complete) return Promise.resolve();
                return new Promise(resolve => {
                    const done = () => resolve();
                    image.addEventListener('load', done, { once: true });
                    image.addEventListener('error', done, { once: true });
                    setTimeout(done, 2500);
                });
            });
            const fontsReady = iframeDoc.fonts && iframeDoc.fonts.ready
                ? Promise.race([iframeDoc.fonts.ready, new Promise(resolve => setTimeout(resolve, 2500))])
                : Promise.resolve();
            return Promise.all([Promise.all(imageLoads), fontsReady]);
        };

        // Do not block the rest of setup on a third-party asset forever.  The
        // carousel is functional even when one image/CDN request fails.
        if (!iframeDoc.documentElement.dataset.aedosLayoutSettled) {
            iframeDoc.documentElement.dataset.aedosLayoutSettled = 'pending';
            const finishPreviewLayout = () => {
                iframeDoc.documentElement.dataset.aedosLayoutSettled = 'ready';
                try {
                    setupPreviewInteractions(targetIndex);
                } catch (error) {
                    console.error('[Aedos] Preview layout setup failed after assets settled.', error);
                }
            };
            settlePreviewLayout().then(finishPreviewLayout, (error) => {
                console.error('[Aedos] Preview asset settling failed; continuing with available layout.', error);
                finishPreviewLayout();
            });
            return;
        }

        // ── INJECT GOOGLE FONTS INTO LIVE PREVIEW IFRAME ──
        // The AI-generated HTML only imports the theme fonts (e.g. Syne + DM Sans via @import).
        // Font picker options like Playfair Display, Bebas Neue, etc. are NOT loaded in this document,
        // so changing font-family has no visual effect even though the inline style is applied correctly.
        // Fix: explicitly create <link> elements in the iframe's <head>.
        if (iframeDoc.head && !iframeDoc.head.querySelector('link[data-fonts]')) {
            const preconnect1 = iframeDoc.createElement('link');
            preconnect1.rel = 'preconnect';
            preconnect1.href = 'https://fonts.googleapis.com';
            iframeDoc.head.appendChild(preconnect1);

            const preconnect2 = iframeDoc.createElement('link');
            preconnect2.rel = 'preconnect';
            preconnect2.href = 'https://fonts.gstatic.com';
            preconnect2.crossOrigin = 'anonymous';
            iframeDoc.head.appendChild(preconnect2);

            const fontLink = iframeDoc.createElement('link');
            fontLink.rel = 'stylesheet';
            fontLink.dataset.fonts = '1';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap';
            iframeDoc.head.appendChild(fontLink);
            uiLog.info('PREVIEW', 'Google Fonts injected into live preview iframe');
        }

        const slides = findSlides(iframeDoc);
        previewState.totalSlides = slides.length || 1;
        // buildDots() was redundant here as it's called after restoration anyway

        // Attach global nav listeners only once to avoid memory leaks and CPU peaks
        if (!iframeDoc._listenersAttached) {
            iframeDoc.addEventListener('wheel', handleSlideWheelNav, { passive: true });
            iframeDoc.addEventListener('touchstart', handleTouchStart, { passive: true });
            iframeDoc.addEventListener('touchend', handleTouchEnd, { passive: true });
            iframeDoc._listenersAttached = true;
        }


        // Determine the container that holds the slides (could be body or a wrapper like <main>)
        previewState.slideContainer = (slides.length > 0) ? slides[0].parentElement : iframeDoc.body;

        // ── CRITICAL: Lock slide dimensions to absolute CSS pixels ──
        // (1122px x 631px) ensuring cross-os consistency regardless of host DPI.
        const naturalSlideW = 1122;

        // Fix each slide to the captured pixel width AND height
        slides.forEach(s => {
            s.style.flex = `0 0 1122px`;
            s.style.width = `1122px`;
            s.style.height = '631px';
            s.style.overflow = 'hidden';
            s.style.position = 'relative';
            s.style.boxSizing = 'border-box';
        });

        // If we are restoring state, we handle overlay re-keying in the 'state-restored' event listener
        // instead of doing a full destructive clear and rebuild here.
        if (!iframeDoc._restoringState) {
            injectImageReplacementSystem(iframeDoc);
        }

        // Apply horizontal carousel layout to the real slide container
        previewState.slideContainer.style.display = 'flex';
        previewState.slideContainer.style.flexDirection = 'row';
        previewState.slideContainer.style.width = 'max-content';
        previewState.slideContainer.style.height = '100%';
        previewState.slideContainer.style.margin = '0';
        previewState.slideContainer.style.padding = '0';

        // Problem 9: Restore the "rewind" effect. 
        // We capture how far the skeleton went and start the final render from there.
        const startSlide = previewState.currentSlide;
        if (startSlide > 0) {
            previewState.slideContainer.style.transform = `translateX(-${startSlide * naturalSlideW}px)`;
            // Force reflow BEFORE applying transition so the browser sees the start position
            void previewState.slideContainer.offsetWidth;
        }

        previewState.slideContainer.style.transition = 'transform 1.2s cubic-bezier(0.25, 1, 0.5, 1)';

        // Match minimap rewind speed
        const ml = document.getElementById('minimap-list');
        if (ml) ml.style.transition = 'transform 1.2s cubic-bezier(0.25, 1, 0.5, 1)';

        // Important: we don't reset currentSlide to 0 until scrollToSlide(targetIndex) runs
        scrollToSlide(targetIndex);

        // After the rewind is done, return to a faster, more responsive speed for editing
        setTimeout(() => {
            if (previewState.slideContainer) {
                previewState.slideContainer.style.transition = 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
            }
            if (ml) {
                ml.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
            }
        }, 1300);

        // Update overlays when carrousel transition ends
        previewState.slideContainer.removeEventListener('transitionend', _refreshSlotOverlays);
        previewState.slideContainer.addEventListener('transitionend', () => {
            if (_refreshSlotOverlays) _refreshSlotOverlays();
        });

        // Store for scrollToSlide to use without re-measuring
        previewState.previewIframe._slideWidthPx = naturalSlideW;

        // Ensure no scrollbars ever show up in the preview window
        iframeDoc.documentElement.style.overflow = 'hidden';
        iframeDoc.body.style.overflow = 'hidden';
        iframeDoc.body.style.margin = '0';
        iframeDoc.body.style.padding = '0';

        scrollToSlide(targetIndex);
        updateSlideCounter();
        scaleIframe();
        window.addEventListener('resize', scaleIframe);

        // Remove the skeleton-active class safely AFTER applying final layouts to avoid scrollbars
        iframeDoc.documentElement.classList.remove('skeleton-active');
        previewHeader.classList.add('slide-down');

        // Force reset scroll positions left over by 'scrollIntoView' during the skeleton stream!
        // This was making the absolute transform value fight with the document's scroll offset.
        if (previewState.previewIframe.contentWindow) previewState.previewIframe.contentWindow.scrollTo(0, 0);
        if (iframeDoc.documentElement) iframeDoc.documentElement.scrollLeft = 0;
        if (iframeDoc.body) iframeDoc.body.scrollLeft = 0;

        // Init React-like declarative UI binding for Editor Panels
        if (typeof window.initEditorUI === 'function' && !iframeDoc._aedosEditorUIReady) {
            try {
                window.initEditorUI(previewState.previewIframe);
                iframeDoc._aedosEditorUIReady = true;
            } catch (error) {
                // A panel failure must not prevent the carousel from becoming
                // usable. It can be retried on the next preview refresh.
                iframeDoc._aedosEditorUIError = error;
                uiLog.warn('PREVIEW', 'Editor UI initialization failed; keeping carousel active', {
                    message: error && error.message ? error.message : String(error)
                });
            }
        }

        // On mobile: canvas is read-only. Image-slot overlays (parent-frame labels) are
        // independent of the lock so photo upload still works normally.
        if (isMobileViewport()) {
            const iw = previewState.previewIframe.contentWindow;
            if (iw && typeof iw.setLocked === 'function') {
                iw.setLocked(true);
            }
        }

        // Soft-regenerate can leave the fresh minimap cloning from a DOM that has not yet been
        // normalized by the editor. The user's manual workaround (select any element) triggers
        // freezeSlideLayout() and then the minimap refreshes from that stable geometry. Do the
        // same here before initMinimap builds the final thumbnails.
        if (_stabilizeMinimapOnNextPreviewInit) {
            const iw = previewState.previewIframe.contentWindow;
            if (iw && typeof iw.freezeAllSlides === 'function') {
                iw.freezeAllSlides();
            }
            _stabilizeMinimapOnNextPreviewInit = false;
        }

        // Building all thumbnail iframes is the heaviest synchronous step in
        // preview setup.  Do not hold the editor reveal on it: on a deck with
        // remote images/fonts, the browser can spend several seconds doing
        // layout and parsing while the finished slide is already visible.
        // Schedule it after the first paint so the carousel remains responsive.
        if (!iframeDoc._aedosEditorSubsystemsScheduled) {
            iframeDoc._aedosEditorSubsystemsScheduled = true;
            const initializeEditorSubsystems = () => {
                try {
                    if (typeof window.initMinimap === 'function' && !iframeDoc._aedosMinimapReady) {
                        window.initMinimap(previewState.previewIframe);
                        iframeDoc._aedosMinimapReady = true;
                        previewUiState.minimapAlreadyInit = true;
                    }
                    if (typeof window.initTools === 'function' && !iframeDoc._aedosToolsReady) {
                        window.initTools(previewState.previewIframe);
                        iframeDoc._aedosToolsReady = true;
                        previewUiState.toolsAlreadyInit = true;
                    }
                } catch (error) {
                    uiLog.warn('PREVIEW', 'Editor subsystem initialization failed; keeping carousel active', {
                        message: error && error.message ? error.message : String(error)
                    });
                } finally {
                    iframeDoc._aedosEditorSubsystemsScheduled = false;
                }
            };

            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(initializeEditorSubsystems, { timeout: 250 });
            } else {
                setTimeout(initializeEditorSubsystems, 0);
            }
        }

        // Fix #4/#5/#6: After Ctrl+Z, restoreState replaces body.innerHTML, creating NEW
        // DOM nodes. Parent labels are still valid but _overlayMap keys point to DEAD nodes.
        // Strategy: re-key the map by matching data-image-slot IDs (stable across restores).
        // This avoids duplicate listeners and the full rebuild/teardown cost.
        window.AedosPreview.createStateRestoreHandler({ previewState, setupPreviewInteractions, getOverlayMap: () => _overlayMap, getBuildOverlayForSlot: () => _buildOverlayForSlot, getEnsureInternalOverlay: () => window._ensureInternalOverlay, findSlides, buildDots, scrollToSlide, updateSlideCounter, getRefreshSlotOverlays: () => _refreshSlotOverlays });

        // Warn user before leaving with unsaved work (bug #7)
        // Handled globally by the conditional beforeunload listener in app.js

        // Fix #8: Recalculate iframe scale when the right tools panel changes width
        const toolsPanel = document.getElementById('editor-tools-panel');
        if (toolsPanel && window.ResizeObserver) {
            const panelResizeObs = new ResizeObserver(() => {
                requestAnimationFrame(() => scaleIframe());
            });
            panelResizeObs.observe(toolsPanel);
        }
    }

    window.regenerateDotsCount = function () {
        const iframeDoc = previewState.previewIframe.contentDocument || previewState.previewIframe.contentWindow.document;
        if (!iframeDoc) return;
        const slides = findSlides(iframeDoc);
        previewState.totalSlides = slides.length || 1;

        // Refresh slideContainer reference (it might have been replaced during Undo/Redo)
        previewState.slideContainer = (slides.length > 0) ? slides[0].parentElement : iframeDoc.body;

        if (previewState.slideContainer) {
            previewState.slideContainer.style.cssText += '; display:flex !important; flex-direction:row !important; width:max-content !important; height:100%; transition:transform 0.6s cubic-bezier(0.25,1,0.5,1); margin:0; padding:0;';
        }



        // Ensure new slides have the correct layout/scaling
        slides.forEach(s => {
            s.style.flex = `0 0 1122px`;
            s.style.width = `1122px`;
            s.style.height = '631px';
            s.style.overflow = 'hidden';
            s.style.position = 'relative';
            s.style.boxSizing = 'border-box';
        });

        buildDots();

        // Ensure currentSlide is within bounds before syncing classes
        if (previewState.currentSlide >= previewState.totalSlides) {
            previewState.currentSlide = previewState.totalSlides - 1;
        }
        if (previewState.currentSlide < 0) previewState.currentSlide = 0;

        // Force 'active' class to match currentSlide JS state
        slides.forEach((s, idx) => {
            if (idx === previewState.currentSlide) s.classList.add('active');
            else s.classList.remove('active');
        });

        scrollToSlide(previewState.currentSlide);
        updateSlideCounter();



        // Refresh overlays because new slides might have slots
        if (_refreshSlotOverlays) setTimeout(_refreshSlotOverlays, 50);
    };


    const { syncZoomStateWithViewportMode, updateZoomDisplay } = window.AedosPreview.createZoomControls({ MOBILE_BREAKPOINT, resetMobileZoomState });

    const { scaleIframe, handleFullscreenChange } = window.AedosPreview.createIframeScale({ previewState, previewContainer, syncZoomStateWithViewportMode, updateZoomDisplay, clearStageInlinePadding, getRefreshSlotOverlays: () => _refreshSlotOverlays });
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    let _buildOverlayForSlot = () => { }; // forward.. declaration, assigned inside injectImageReplacementSystem

    function injectImageReplacementSystem(doc, isRestoringFlow = false) {
        window.AedosPreview.createOverlayStyle({ doc });

        // ── Persistent parent-side label overlays ─────────────────────────────
        // WHY THIS APPROACH:
        //   • Clicks inside an iframe go to the iframe's document — NOT to the
        //     <iframe> element in the parent. So pointerdown on the iframe element
        //     never fires for inner-iframe clicks.
        //   • postMessage from iframe → parent is async → loses user activation →
        //     _picker.click() gets blocked by the browser.
        //   • SOLUTION: Place real <label>+<input type=file> elements in the PARENT
        //     document, permanently positioned over each slot's visual area.
        //     A click on the label (parent DOM) directly opens the picker — no
        //     focus handshake, no async, works on first click on desktop & mobile.

        // PERFORMANCE: If we are in a restore flow, we keep the existing DOM overlays
        // and just re-position them. The re-keying is handled before this call.
        if (!isRestoringFlow && !doc._restoringState) {
            // Remove any overlays from a previous session entirely
            document.querySelectorAll('._slot-overlay-label').forEach(el => el.remove());
            document.querySelectorAll('._slot-overlay-input').forEach(el => el.remove());
            _overlayMap.clear();
        }


        _buildOverlayForSlot = window.AedosPreview.createOverlayLabelBuilder({ overlayMap: _overlayMap, previewState, replaceSlotImage, replaceSlotWithUrl });

        function _ensureInternalOverlay(slot, doc) {
            let overlay = slot.querySelector('.img-replace-overlay');
            if (!overlay) {
                overlay = doc.createElement('div');
                overlay.className = 'img-replace-overlay';
                slot.appendChild(overlay);

                overlay.innerHTML = `
                    <div class="overlay-content" style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span>${isMobileViewport() ? window.__t('click_drop_mobile') : window.__t('click_drop')}</span>
                    </div>
                `;
            }
        }
        window._ensureInternalOverlay = _ensureInternalOverlay; // Expose as global helper

        // Build overlays for ALL slots in the document
        const allSlots = doc.querySelectorAll('[data-image-slot]');
        allSlots.forEach(s => _buildOverlayForSlot(s));

        // Double-click on a slot opens the file picker.
        // We expose this as a global function so the editor can call it directly.
        window._triggerImagePicker = (slot) => {
            // Block if in fullscreen (presentation mode)
            if (document.fullscreenElement || document.webkitFullscreenElement) return;

            const entry = _overlayMap.get(slot);
            if (entry) entry.input.click();
        };

        if (doc._dblClickListener) doc.removeEventListener('dblclick', doc._dblClickListener);
        doc._dblClickListener = (e) => {
            // Block if in fullscreen (presentation mode)
            if (document.fullscreenElement || document.webkitFullscreenElement) return;

            const slot = e.target.closest('[data-image-slot]');
            if (!slot) return;
            e.preventDefault();
            e.stopPropagation();
            window._triggerImagePicker(slot);
        };
        doc.addEventListener('dblclick', doc._dblClickListener);


        // Remove old custom event listener to avoid confusion
        // Remove old custom event listener to avoid confusion
        if (doc._triggerListener) doc.removeEventListener('trigger-image-picker', doc._triggerListener);
        doc._triggerListener = (e) => {
            if (e.detail && e.detail.element) window._triggerImagePicker(e.detail.element);
        };
        doc.addEventListener('trigger-image-picker', doc._triggerListener);




        // Enable labels only while a file is being dragged. Reset on drop/dragleave.
        window.addEventListener('dragenter', () => {
            if (typeof pruneDeadSlotOverlays === 'function') pruneDeadSlotOverlays();
            _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'auto'; });
        });
        window.addEventListener('dragleave', (e) => {
            // Only reset when leaving the window entirely
            if (e.relatedTarget == null) {
                _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'none'; });
            }
        });
        window.addEventListener('drop', () => {
            _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'none'; });
        });

        window.addEventListener('drop-complete', () => {
            _overlayMap.forEach(({ label }) => { label.style.pointerEvents = 'none'; });
        });

        const { pruneDeadSlotOverlays, positionOverlays } = window.AedosPreview.createOverlayPositioning({ previewState, overlayMap: _overlayMap, isMobileViewport });
        window._pruneDeadSlotOverlays = pruneDeadSlotOverlays;
        _refreshSlotOverlays = positionOverlays;
        window._refreshSlotOverlays = positionOverlays;
        window._buildOverlayForSlot = _buildOverlayForSlot;

        // Message handler is no longer needed since overlays handle everything directly
        if (window._slotMsgHandler) {
            window.removeEventListener('message', window._slotMsgHandler);
            window._slotMsgHandler = null;
        }
        // ──────────────────────────────────────────────────────────────────────


        const slots = doc.querySelectorAll('[data-image-slot], .img-slot');
        slots.forEach(slot => {
            const slotId = slot.dataset.imageSlot;

            // Ensure it has data-image-slot for consistency if it's an .img-slot
            if (!slot.dataset.imageSlot) {
                slot.dataset.imageSlot = 'gen-' + Math.random().toString(36).substr(2, 9);
            }

            // Ensure every normalized slot has a parent-side input/label entry.
            // Some templates define only .img-slot (without data-image-slot), and
            // those were previously skipped by the first overlay build pass.
            _buildOverlayForSlot(slot);

            // Hide decorative shapes (circles/blobs) — keep gradient overlays
            Array.from(slot.children).forEach(child => {
                const s = child.style;
                if (s.width && s.width !== '100%' && s.height && s.height !== '100%' && s.borderRadius === '50%') {
                    child.style.display = 'none';
                }
            });

            // For full-bleed slots (cover slides): the slot is a background layer.
            // Siblings render ON TOP (z-index:2) and have pointer-events:none so
            // the parent-side label overlay still shows above everything and
            // the user can always click/tap to pick an image.
            const computedPos = doc.defaultView.getComputedStyle(slot).position;
            const isFullBleed = computedPos === 'absolute' &&
                slot.parentElement && slot.parentElement.tagName === 'SECTION';
            if (isFullBleed) {
                Array.from(slot.parentElement.children).forEach(child => {
                    if (child !== slot) {
                        child.style.zIndex = '2'; // text renders above background image
                    }
                });
                slot.style.zIndex = '0';
            }
            // Note: pointer-events on siblings are left as-is — the parent label
            // overlay (z-index:200) handles all click routing.

            // "Click or drop image" tooltip
            _ensureInternalOverlay(slot, doc);

            // Drag & drop (works directly, no scaling issue)
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slot.classList.add('drag-over');
            });
            slot.addEventListener('dragleave', (e) => {
                e.preventDefault();
                slot.classList.remove('drag-over');
            });
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                slot.classList.remove('drag-over');

                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith('image/')) {
                        replaceSlotImage(slot, file);
                        return;
                    }
                }
                const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
                    replaceSlotWithUrl(slot, imageUrl);
                }
            });
        });

        // Prevent browser default drag-and-drop navigation inside the iframe.
        // Without this, dropping a file anywhere on the iframe navigates it to the file URL.
        doc.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
        doc.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Handle dropping images onto the slide (NOT onto a slot)
            const slot = e.target.closest('[data-image-slot]');
            if (slot) return; // handled by slot listener

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith('image/')) {
                    // Position it where dropped
                    const rect = doc.documentElement.getBoundingClientRect();
                    const x = e.clientX;
                    const y = e.clientY;

                    // Trigger a custom event to the parent to handle adding a new image at these coords
                    window.parent.dispatchEvent(new CustomEvent('add-image-at', {
                        detail: {
                            file: file,
                            x: x,
                            y: y
                        }
                    }));
                }
            }
        });

        // Initial positioning after all slots are set up
        // (done after multiple delays to account for carousel transition, font loading, etc.)
        setTimeout(positionOverlays, 100);
        setTimeout(positionOverlays, 500);
        setTimeout(positionOverlays, 1500);
    }


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

    // =========================================================
    // 10. RESET
    // =========================================================
    function resetUI() {
        document.body.classList.remove('no-scroll');
        errorModal.clearOnDismiss();
        // Show chat again
        if (resultContainer) resultContainer.classList.add('hidden');
        if (errorContainer) errorContainer.classList.add('hidden');
        if (refusedContainer) refusedContainer.classList.add('hidden');
        if (previewContainer) previewContainer.classList.add('hidden');
        if (chatScreen) {
            chatScreen.style.cssText = ''; // clear any in-progress fade
            chatScreen.classList.remove('hidden');
        }

        previewState.currentSlide = 0;
        previewState.totalSlides = 0;
        previewState.generatedHtml = '';
        previewState.slideContainer = null;
        _refreshSlotOverlays = null;
        // Remove persistent slot overlays from previous presentation
        document.querySelectorAll('._slot-overlay-label').forEach(el => el.remove());
        document.querySelectorAll('._slot-overlay-input').forEach(el => el.remove());
        slideDots.innerHTML = '';
        if (mobileSlideDots) mobileSlideDots.innerHTML = '';
        if (mobileSlideLabel) mobileSlideLabel.textContent = '1 / 1';
        progressBarEl.style.transition = 'none';
        progressBarEl.style.width = '0%';

        // restart typewriter if empty
        if (document.getElementById('w-tema').value.trim() === '') {
            if (chatState.chatPlaceholderContainer) chatState.chatPlaceholderContainer.style.display = '';
            startTypewriter();
        }
    }

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
