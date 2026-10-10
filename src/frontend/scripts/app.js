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

    const modelBtn = document.getElementById('btn-model-dropdown');
    const modelMenu = document.getElementById('model-dropdown-menu');
    const langBtn = document.getElementById('btn-lang-dropdown');
    const langMenu = document.getElementById('lang-dropdown-menu');
    const exportMenuBtn = document.getElementById('export-menu-trigger');
    const exportMenu = document.getElementById('export-dropdown-menu');
    const exportPptxBtn = document.getElementById('export-pptx-btn');
    const currentModelLabel = document.getElementById('current-model-label');
    const currentModelIcon = document.getElementById('current-model-icon');
    const currentLangLabel = document.getElementById('current-lang-label');
    const chatInputWrapper = document.querySelector('.chat-input-wrapper');

    // Keep the outline actions and scroll end above the floating composer,
    // including when its textarea or attachment preview changes height.
    if (chatScreen && chatInputWrapper) {
        const updateComposerClearance = () => {
            const composerTop = chatInputWrapper.getBoundingClientRect().top;
            const viewportBottom = chatScreen.getBoundingClientRect().bottom;
            const clearance = Math.max(0, viewportBottom - composerTop + 16);
            chatScreen.style.setProperty('--chat-composer-clearance', `${clearance}px`);
        };
        if (window.ResizeObserver) {
            new ResizeObserver(updateComposerClearance).observe(chatInputWrapper);
        }
        new MutationObserver(updateComposerClearance).observe(chatScreen, {
            attributes: true,
            attributeFilter: ['class']
        });
        window.addEventListener('resize', updateComposerClearance);
        window.visualViewport?.addEventListener('resize', updateComposerClearance);
        updateComposerClearance();
    }

    window.AedosAppDropdowns.createAppDropdowns({
        document,
        window,
        generationState,
        finalizeBtn,
        elements: {
            modelBtn, modelMenu,
            modelOptions: document.getElementById('model-dropdown-options'),
            modeButtons: Array.from(document.querySelectorAll('[data-generation-mode]')),
            langBtn, langMenu, exportMenuBtn, exportMenu,
            exportPptxBtn, currentModelLabel, currentModelIcon, currentLangLabel, chatInputWrapper,
        },
    });
    window.AedosCreditsUI?.init();

    window.AedosPreview.createPreviewMessageBridge({
        window, document, previewState, previewContainer, slideLabel,
        setPreviewStreamStatus, updateMinimapSkeleton,
        getBuildDots: () => buildDots,
        getPreviewUiState: () => previewUiState,
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

    const runGenerateValidation = window.AedosChatValidation.createGenerateValidation({
        window, generationState, btnGenerate, temaInput,
        getAnimateHeroTitle: () => animateHeroTitle,
    });

    window.AedosAttachments.createAttachments({
        btnAttachFile,
        fileUploadInput,
        attachmentPreviewContainer,
        validateGenerateButton
    });

    function validateGenerateButton() { return runGenerateValidation(); }
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
        modeBtn: modelBtn,
        langBtn,
        btnAttachFile,
        validateGenerateButton,
        stopTypewriter,
        getUpdateZoomDisplay: () => typeof updateZoomDisplay === 'function' ? updateZoomDisplay : null,
    });

    const resetPreviewSurface = window.AedosPreview.createPreviewSurfaceReset({
        window, document, previewState, slideDots,
        getDeps: () => ({ scaleIframe, previewUiState }),
        setRefreshSlotOverlays: value => { _refreshSlotOverlays = value; },
        setOverlayMap: value => { _overlayMap = value; },
    });

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

    window.startFinalGeneration = window.AedosGeneration.createFinalGeneration({
        getDeps: () => ({
            window, document, generationState, previewState, previewUiState,
            previewContainer, previewHeader, chatScreen, refusedMessage,
            refusedContainer, errorMessage, showErrorModal, uiLog, generateBtn,
            pauseBtnMessages, resumeBtnMessages, toggleGenerateLoading,
            appendReasoningProgress, showStageProgress, setPreviewStreamStatus,
            FormData, AbortController, fetch, clearTimeout, setTimeout,
            initPreview, scaleIframe, clearInterval,
            slideDots, slideLabel, stopBtnMessages, resetMobileZoomState,
            updateZoomDisplay, clearStageInlinePadding, updateMinimapSkeleton,
            requestAnimationFrame,
            clearPendingTransition: () => { _pendingTransitionFn = null; },
            setStabilizeMinimapOnNextPreviewInit: value => { _stabilizeMinimapOnNextPreviewInit = value; },
        }),
    });

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



    window.AedosPreview.createPreviewExitActions({
        window, document, generationState, confirm, setTimeout, Event,
    });

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
