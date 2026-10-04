// Outline Editor Logic

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
    alert: message => window.alert(message),
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

window.prepareOutlineStreaming = function(mode) {
    window.outlineEditorState.isLoading = true;
    window.outlineEditorState.skeleton = null;
    window.outlineEditorState.mode = mode;
    window.outlineEditorState.maxSlides = mode === 'pro' ? 8 : 15;

    const activeOutlineDom = mountActiveOutlineContainer(getActiveOutlineContainer());
    const container = activeOutlineDom.slidesContainer;
    if (container) container.innerHTML = '';
    
    const btnGenerate = document.getElementById('btn-generate');
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnGenerate) {
        btnGenerate.classList.add('is-generating');
        btnGenerate.disabled = false;
    }
    if (btnLang) btnLang.disabled = true;
    
    const pills = document.getElementById('suggestion-pills-row');
    if (pills) { pills.style.transition = 'opacity 0.3s'; pills.style.opacity = '0'; pills.style.pointerEvents = 'none'; }
    const microcopy = document.querySelector('.app-microcopy');
    if (microcopy) { microcopy.style.transition = 'opacity 0.3s'; microcopy.style.opacity = '0'; }
    const counter = document.querySelector('.chat-counter-row');
    if (counter) { counter.style.transition = 'opacity 0.3s'; counter.style.opacity = '0'; }

    const outlineContainer = activeOutlineDom.container;
    if (outlineContainer) outlineContainer.classList.remove('hidden');

    const chipsContainer = activeOutlineDom.chipsContainer;
    if (chipsContainer) {
        chipsContainer.innerHTML = '';
        if (window._chipsRenderTimeout) clearTimeout(window._chipsRenderTimeout);
    }
};

window.renderStreamingOutline = function(partialSkeleton) {
    const container = getOutlineDom().slidesContainer;
    if (!container) return;
    window.AedosOutlineStreamRenderer.renderPartialOutline(container, partialSkeleton, scrollToBottom);
};

window.finalizeStreamingOutline = function(finalSkeleton) {
    window.outlineEditorState.skeleton = finalSkeleton;
    
    // Populate hidden config tags
    const titleInput = document.getElementById('outline-title-input');
    if (titleInput) { titleInput.value = finalSkeleton.topic || ''; titleInput.disabled = false; }
    const toneVal = finalSkeleton.tone || 'academic';
    const toneEl = document.getElementById('outline-tone-select');
    if (toneEl) { toneEl.value = toneVal; if (!toneEl.value) toneEl.value = 'academic'; }
    const audEl = document.getElementById('outline-audience-select');
    if (audEl) audEl.value = finalSkeleton.audience || 'general';
    const densEl = document.getElementById('outline-density-select');
    if (densEl) densEl.value = finalSkeleton.density || finalSkeleton.text_density || 'medium';
    const subEl = document.getElementById('outline-subtitle-input');
    if (subEl) subEl.value = finalSkeleton.subtitle_context || '';

    // Render standard slides to replace disabled textareas and bind all events (like draggable, inputs etc.)
    renderOutlineSlides();
    
    // Render Suggested Action Chips Row
    window.renderOutlineSuggestedChips(finalSkeleton);

    // Mark loading as false and enable controls
    window.outlineEditorState.isLoading = false;
    
    // Re-enable global buttons and remove is-generating class
    const btnGenerate = document.getElementById('btn-generate');
    if (btnGenerate) {
        btnGenerate.classList.remove('is-generating');
        btnGenerate.disabled = false;
    }
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnLang) btnLang.disabled = false;
    
    const outlineDom = getOutlineDom();
    const btnGen = outlineDom.generateButton;
    const btnAdd = outlineDom.addSlideButton;
    if (btnGen) btnGen.disabled = false;
    if (btnAdd) btnAdd.disabled = false;
    
    if (typeof window.validateGenerateButton === 'function') {
        window.validateGenerateButton();
    }
};

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
    bindOutlineEvents();
}

function bindOutlineEvents() {
    window.AedosOutlineEditorBindings.bindOutlineEditorEvents({
        getSlides: () => window.outlineEditorState.skeleton.slides,
        renderSlides: renderOutlineSlides,
        updateSlideCount: updateOutlineSlideCount,
    });
}

window.stopOutlineGeneration = function () {
    // 1. Render all slides statically right away so the user doesn't lose what was streamed so far
    if (window.outlineEditorState && window.outlineEditorState.skeleton) {
        renderOutlineSlides();
        window.renderOutlineSuggestedChips(window.outlineEditorState.skeleton);
    }

    // 2. Mark loading as false and enable controls
    window.outlineEditorState.isLoading = false;

    // 3. Re-enable global buttons and remove is-generating class
    const btnGenerate = document.getElementById('btn-generate');
    if (btnGenerate) {
        btnGenerate.classList.remove('is-generating');
        btnGenerate.disabled = false;
    }
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnLang) btnLang.disabled = false;

    const outlineDom = getOutlineDom();
    const btnGen = outlineDom.generateButton;
    const btnAdd = outlineDom.addSlideButton;
    if (btnGen) btnGen.disabled = false;
    if (btnAdd) btnAdd.disabled = false;

    if (typeof window.validateGenerateButton === 'function') {
        window.validateGenerateButton();
    }
};

function updateOutlineSlideCount() {
    const slides = window.outlineEditorState.skeleton.slides || [];
    const countEl = document.getElementById('outline-slide-count');
    if (countEl) countEl.textContent = `${slides.length} slides`;

    const addSlideBtn = getOutlineDom().addSlideButton;
    if (addSlideBtn) {
        if (slides.length >= window.outlineEditorState.maxSlides) {
            addSlideBtn.disabled = true;
            addSlideBtn.title = `Maximum limit of ${window.outlineEditorState.maxSlides} slides reached.`;
        } else {
            addSlideBtn.disabled = false;
            addSlideBtn.title = '';
        }
    }
}

function getSlideCommandDependencies() {
    return {
        getSlides: () => window.outlineEditorState.skeleton.slides,
        getMaxSlides: () => window.outlineEditorState.maxSlides,
        renderSlides: renderOutlineSlides
    };
}

function addBlankSlide() {
    return window.AedosOutlineSlideCommands.addBlankSlide(getSlideCommandDependencies());
}

async function addSlideWithAI() {
    const slides = window.outlineEditorState.skeleton.slides;
    if (slides.length >= window.outlineEditorState.maxSlides) return;

    const topic = document.getElementById('outline-title-input').value;

    const btn = document.getElementById('btn-add-slide-ai');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Generating...';
    btn.disabled = true;

    // Inject a loading skeleton card at the bottom
    const container = getOutlineDom().slidesContainer;
    if (!container) return;
    const loadingCard = document.createElement('div');
    loadingCard.className = 'outline-slide-card is-loading is-ai-loading is-new';
    loadingCard.innerHTML = `
        <div class="outline-slide-bg-indicator" style="background-color: #121212"></div>
        <div class="outline-slide-number skeleton-loading-pulse" style="color:transparent">-</div>
        <div class="outline-slide-content">
            <div class="outline-slide-header">
                <div class="outline-slide-title skeleton-loading-pulse"></div>
                <div class="outline-slide-type-select skeleton-loading-pulse" style="width: 80px; height: 1.5rem; border-radius: 6px;"></div>
            </div>
            <div class="outline-slide-desc skeleton-loading-pulse"></div>
            <div class="outline-points-list">
                <div class="outline-point-item">
                    <span class="outline-point-bullet skeleton-loading-pulse"></span>
                    <div class="outline-point-input skeleton-loading-pulse"></div>
                </div>
                <div class="outline-point-item">
                    <span class="outline-point-bullet skeleton-loading-pulse"></span>
                    <div class="outline-point-input skeleton-loading-pulse" style="width: 60%"></div>
                </div>
            </div>
        </div>
    `;
    container.appendChild(loadingCard);

    // Animate the skeleton in and scroll to bottom immediately
    requestAnimationFrame(() => {
        const main = document.querySelector('.outline-main');
        if (main) main.scrollTop = main.scrollHeight;
        loadingCard.classList.add('is-new-visible');
    });

    try {
        const response = await fetch('/generate-outline-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'slide',
                topic: topic,
                existingSlides: slides
            })
        });

        if (!response.ok) throw new Error('Generation failed');

        const data = await response.json();
        if (data.item) {
            slides.push(data.item);
            renderOutlineSlides();
            // Same enter animation as addBlankSlide
            const main = document.querySelector('.outline-main');
            requestAnimationFrame(() => {
                if (main) main.scrollTop = main.scrollHeight;
                const cards = document.querySelectorAll('.outline-slide-card');
                const newCard = cards[cards.length - 1];
                if (newCard) {
                    newCard.classList.add('is-new');
                    requestAnimationFrame(() => newCard.classList.add('is-new-visible'));
                    setTimeout(() => { newCard.classList.remove('is-new', 'is-new-visible'); }, 500);
                }
            });
        }
    } catch (e) {
        console.error(e);
        alert('Failed to generate slide. Please try again.');
    } finally {
        // Remove the loading skeleton card (renderOutlineSlides would overwrite it anyway, but this is safer for failures)
        if (loadingCard && loadingCard.parentNode) {
            loadingCard.parentNode.removeChild(loadingCard);
        }
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
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
    if (!window.outlineEditorState.skeleton) {
        window.outlineEditorState.skeleton = { slides: [] };
    }

    // Ensure all editing UI elements are visible when resuming a real draft
    document.querySelector('.outline-sidebar')?.style.removeProperty('display');
    document.querySelector('.outline-main-header')?.style.removeProperty('display');
    document.getElementById('legacy-outline-title-input')?.style.removeProperty('display');
    document.querySelector('.outline-floating-footer')?.style.removeProperty('display');
    const emptyState = document.getElementById('outline-empty-state');
    if (emptyState) emptyState.classList.add('hidden');

    if (window.__applyTranslations) window.__applyTranslations();

    // Sync custom dropdown UI values when resuming
    if (typeof syncCustomDropdowns === 'function') syncCustomDropdowns();

    const outlineContainer = getActiveOutlineContainer();
    if (outlineContainer) outlineContainer.classList.remove('hidden');

    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop) backdrop.classList.add('active');

    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) {
        edgeTab.classList.add('is-open');
        const tabText = edgeTab.querySelector('span');
        if (tabText) tabText.textContent = window.__t ? window.__t('close_draft', 'Close draft') : 'Close draft';
    }

    const heroTextSpan = document.querySelector('.hero-title-text');
    if (heroTextSpan) {
        // Kill typewriter before overwriting hero text
        if (window._heroTypewriterTimer) {
            clearTimeout(window._heroTypewriterTimer);
            window._heroTypewriterTimer = null;
        }
        if (window._heroResetTimer) {
            clearTimeout(window._heroResetTimer);
            window._heroResetTimer = null;
        }
        if (window._btnMsgTimer) {
            clearTimeout(window._btnMsgTimer);
            window._btnMsgTimer = null;
        }
        const heroTitle = document.querySelector('.hero-title');
        if (window.gsap && heroTitle) {
            window.gsap.killTweensOf(heroTitle);
            window.gsap.set(heroTitle, { x: 0, opacity: 1 });
        }
        if (!heroTextSpan.getAttribute('data-original-text')) {
            heroTextSpan.setAttribute('data-original-text', heroTextSpan.textContent);
        }
        if (window.outlineEditorState.isLoading) {
            heroTextSpan.textContent = window.__t ? window.__t('generating_outline', 'Generating structure...') : 'Generating structure...';
        } else {
            heroTextSpan.textContent = window.__t ? window.__t('waiting_for_user', 'Waiting for your review...') : 'Waiting for your review...';
        }
        heroTextSpan.parentElement.classList.add('waiting-state');
    }
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
