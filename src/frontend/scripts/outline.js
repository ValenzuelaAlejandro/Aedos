// Outline Editor Logic
// Manual additions stop at eight even when Flash generation allows a larger outline.
const MAX_USER_ADDED_OUTLINE_SLIDES = 15;

/**
 * Returns the innerHTML for a .chat-bubble-file-chip span.
 * Uses the same colorful document icons as the chatbox attachment area.
 */
function _fileBubbleChipHtml(file) {
    return window.AedosChatRenderer.renderFileChip(file);
}

const outlineContainerUi = window.AedosOutlineContainerUi.createOutlineContainerUi({
    document,
    getState: () => window.outlineEditorState,
    addBlankSlide: () => addBlankSlide(),
    translate: (key, fallback) => window.__t ? window.__t(key, fallback) : fallback,
    alert: message => window.AedosModals.showNotice(message),
    startFinalGeneration: skeleton => {
        if (window.startFinalGeneration) window.startFinalGeneration(skeleton);
    }
});
const {
    scrollToBottom,
    getActiveOutlineContainer,
    getOutlineDom,
    clearOutlineDom,
    mountActiveOutlineContainer,
    bindOutlineBubbleActions,
    createFollowUpOutlineContainer
} = outlineContainerUi;

const outlineStreaming = window.AedosOutlineStreaming.createOutlineStreaming({
    document,
    getState: () => window.outlineEditorState,
    getActiveContainer: () => getActiveOutlineContainer(),
    mountActiveContainer: container => mountActiveOutlineContainer(container),
    getOutlineDom: container => getOutlineDom(container),
    getChipsTimeout: () => window._chipsRenderTimeout,
    scrollToBottom,
    renderSlides: () => renderOutlineSlides(),
    renderChips: skeleton => window.renderOutlineSuggestedChips(skeleton),
    validateGenerateButton: () => {
        if (typeof window.validateGenerateButton === 'function') window.validateGenerateButton();
    }
});


function showOutlineEditorLoading(slideCount = 8) {
    return window.AedosOutlineLoadingView.showOutlineEditorLoading(slideCount, {
        state: window.outlineEditorState,
        getAttachedFiles: () => window._attachedFiles,
        setAttachedFiles: (files) => { window._attachedFiles = files; },
        chipsTimeout: window._chipsRenderTimeout,
        renderFileChip: (file) => _fileBubbleChipHtml(file),
        translate: window.__t && window.__t.bind(window),
        escapeHtml: window.escapeHtml && window.escapeHtml.bind(window),
        gsap: window.gsap,
        thinkingPanel: window.AedosThinking,
        getActiveOutlineContainer,
        mountActiveOutlineContainer,
        bindOutlineBubbleActions,
        getOutlineDom,
        clearOutlineDom,
        createFollowUpOutlineContainer,
        scrollToBottom
    });
}

function parsePartialSkeleton(text) {
    return window.AedosOutlineParser.parsePartialSkeleton(text);
}
window.parsePartialSkeleton = parsePartialSkeleton;

window.prepareOutlineStreaming = function(mode) { return outlineStreaming.prepareOutlineStreaming(mode); };

window.renderStreamingOutline = function(partialSkeleton) { return outlineStreaming.renderStreamingOutline(partialSkeleton); };

window.finalizeStreamingOutline = function(finalSkeleton) { return outlineStreaming.finalizeStreamingOutline(finalSkeleton); };

window.renderOutlineSuggestedChips = function(skeletonData) {
    const chipsContainer = getOutlineDom().chipsContainer;
    if (!chipsContainer) return;
    window.AedosOutlineChipsRenderer.renderSuggestedChips(chipsContainer, skeletonData, {
        previousTimeout: window._chipsRenderTimeout,
        rememberTimeout(timeout) {
            window._chipsRenderTimeout = timeout;
        },
        translate(key, fallback) {
            if (typeof window !== 'undefined' && window.__t) return window.__t(key);
            return fallback;
        },
        proceed() {
            if (typeof window.proceedWithCurrentOutline === 'function') window.proceedWithCurrentOutline();
        },
        submitPrompt(chip) {
            const inputEl = document.getElementById('w-tema');
            const btnGenerateMain = document.getElementById('btn-generate');
            if (inputEl && btnGenerateMain) {
                inputEl.value = chip.prompt || chip.text;
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                btnGenerateMain.disabled = false;
                btnGenerateMain.click();
            }
        },
        animate(button, index) {
            if (window.gsap) {
                window.gsap.fromTo(button,
                    { opacity: 0, scale: 0.95, x: -15 },
                    { opacity: 1, scale: 1, x: 0, duration: 0.4, ease: 'power2.out', delay: index * 0.08 }
                );
            }
        },
    });
};

function initOutlineEditor(skeletonData, mode) {
    window.prepareOutlineStreaming(mode);
    window.finalizeStreamingOutline(skeletonData);
}

function renderOutlineSlides() {
    const container = getOutlineDom().slidesContainer;
    if (!container) return;
    const slides = window.outlineEditorState.skeleton.slides || [];
    window.AedosOutlineRenderer.renderSlides(container, slides);
    window.AedosCreditsUI?.setSlideCount(slides.length);
    bindOutlineEvents();
}

function bindOutlineEvents() {
    window.AedosOutlineEditorBindings.bindOutlineEditorEvents({
        getSlides: () => window.outlineEditorState.skeleton.slides,
        renderSlides: renderOutlineSlides,
        deleteSlide,
        updateSlideCount: updateOutlineSlideCount,
    });
}

window.stopOutlineGeneration = function () { return outlineStreaming.stopOutlineGeneration(); };

function updateOutlineSlideCount() {
    const slides = window.outlineEditorState.skeleton.slides || [];
    const countEl = document.getElementById('outline-slide-count');
    if (countEl) countEl.textContent = `${slides.length} slides`;

    const addSlideBtn = getOutlineDom().addSlideButton;
    if (addSlideBtn) {
        if (slides.length >= getOutlineAddSlideLimit()) {
            addSlideBtn.disabled = true;
            addSlideBtn.title = window.__t
                ? window.__t('outline_add_slide_limit_reached', 'Maximum of 15 slides reached.')
                : 'Maximum of 15 slides reached.';
        } else {
            addSlideBtn.disabled = false;
            addSlideBtn.title = '';
        }
    }
}

function getOutlineAddSlideLimit() {
    const generationLimit = window.outlineEditorState.maxSlides;
    return Number.isFinite(generationLimit)
        ? Math.min(generationLimit, MAX_USER_ADDED_OUTLINE_SLIDES)
        : MAX_USER_ADDED_OUTLINE_SLIDES;
}

function getSlideCommandDependencies() {
    return {
        getSlides: () => window.outlineEditorState.skeleton.slides,
        getMaxSlides: getOutlineAddSlideLimit,
        renderSlides: renderOutlineSlides
    };
}

function addBlankSlide() {
    return window.AedosOutlineSlideCommands.addBlankSlide(getSlideCommandDependencies());
}


function addBlankPoint(slideIndex) {
    return window.AedosOutlineSlideCommands.addBlankPoint(slideIndex, getSlideCommandDependencies());
}

function deleteSlide(index) {
    return window.AedosOutlineSlideCommands.deleteSlide(index, getSlideCommandDependencies());
}

function moveSlideUp(index) {
    return window.AedosOutlineSlideCommands.moveSlideUp(index, getSlideCommandDependencies());
}

function moveSlideDown(index) {
    return window.AedosOutlineSlideCommands.moveSlideDown(index, getSlideCommandDependencies());
}

function resumeOutlineEditor() {
    return window.AedosOutlineResume.resumeOutlineEditor({
        document,
        getState: () => window.outlineEditorState,
        applyTranslations: () => { if (window.__applyTranslations) window.__applyTranslations(); },
        syncCustomDropdowns: () => syncCustomDropdowns(),
        getActiveOutlineContainer: () => getActiveOutlineContainer(),
        getTimer: name => window[name],
        setTimer: (name, value) => { window[name] = value; },
        clearTimeout: timer => window.clearTimeout(timer),
        getGsap: () => window.gsap,
        translate: (key, fallback) => window.__t ? window.__t(key, fallback) : fallback
    });
}

// Global functions
window.showOutlineEditorLoading = showOutlineEditorLoading;
window.initOutlineEditor = initOutlineEditor;
window.resumeOutlineEditor = resumeOutlineEditor;
window.addBlankPoint = addBlankPoint;
window.deleteSlide = deleteSlide;
window.moveSlideUp = moveSlideUp;
window.moveSlideDown = moveSlideDown;

function syncCustomDropdowns() {
    return outlineDrawerControls.syncCustomDropdowns();
}

const outlineDrawerControls = window.AedosOutlineDrawerControls.createOutlineDrawerControls({
    getSkeleton: () => window.outlineEditorState.skeleton,
    bindOutlineBubbleActions,
    getActiveOutlineContainer,
    resumeOutlineEditor,
    confirm: message => window.confirm(message),
    translate: (key, fallback) => window.__t ? window.__t(key, fallback) : fallback,
    applyTranslations: () => { if (window.__applyTranslations) window.__applyTranslations(); },
    abortActiveGeneration: () => {
        if (window._activeGenController) {
            window._activeGenController.abort();
            window._activeGenController = null;
        }
    },
    navigateHome: () => {
        window.location.href = window.location.origin + window.location.pathname;
    }
});
outlineDrawerControls.register();
