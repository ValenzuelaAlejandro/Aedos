// Outline Editor Logic

/**
 * Returns the innerHTML for a .chat-bubble-file-chip span.
 * Uses the same colorful document icons as the chatbox attachment area.
 */
function _fileBubbleChipHtml(file) {
    return window.AedosChatRenderer.renderFileChip(file);
}

function scrollToBottom(force = false) {
    const chatScreen = document.getElementById('chat-screen');
    if (!chatScreen) return;

    const threshold = 180;
    const isAtBottom = (chatScreen.scrollHeight - chatScreen.scrollTop - chatScreen.clientHeight) <= threshold;

    if (force || isAtBottom) {
        chatScreen.scrollTo({
            top: chatScreen.scrollHeight,
            behavior: 'auto'
        });
    }
}

function getActiveOutlineContainer() {
    const activeContainer = window.outlineEditorState?.activeContainer;
    if (activeContainer && document.body.contains(activeContainer)) {
        return activeContainer;
    }

    return document.getElementById('outline-container');
}

function getOutlineDom(container = getActiveOutlineContainer()) {
    if (!container) {
        return {
            container: null,
            slidesContainer: null,
            chipsContainer: null,
            addSlideButton: null,
            generateButton: null
        };
    }

    return {
        container,
        slidesContainer: container.querySelector('[data-outline-slides]') || container.querySelector('#outline-slides-container'),
        chipsContainer: container.querySelector('[data-outline-chips]') || container.querySelector('#outline-suggested-chips'),
        addSlideButton: container.querySelector('[data-outline-add-slide]') || container.querySelector('#btn-outline-add-slide'),
        generateButton: container.querySelector('[data-outline-generate]') || container.querySelector('#btn-outline-generate')
    };
}

function clearOutlineDom(container = getActiveOutlineContainer()) {
    const outlineDom = getOutlineDom(container);
    if (outlineDom.slidesContainer) outlineDom.slidesContainer.innerHTML = '';
    if (outlineDom.chipsContainer) outlineDom.chipsContainer.innerHTML = '';
}

function mountActiveOutlineContainer(container) {
    const fallbackContainer = document.getElementById('outline-container');
    window.outlineEditorState.activeContainer = container && document.body.contains(container)
        ? container
        : fallbackContainer;
    return getOutlineDom(window.outlineEditorState.activeContainer);
}

function handleOutlineGenerateRequest() {
    const activeGenerateButton = getOutlineDom().generateButton;
    if (activeGenerateButton && activeGenerateButton.disabled) return;

    const skel = window.outlineEditorState.skeleton;
    if (!skel) return;

    skel.topic = document.getElementById('outline-title-input').value;
    skel.tone = document.getElementById('outline-tone-select').value;
    skel.audience = document.getElementById('outline-audience-select').value;
    skel.density = document.getElementById('outline-density-select').value;

    const subtitleInput = document.getElementById('outline-subtitle-input');
    if (subtitleInput) skel.subtitle_context = subtitleInput.value.trim();

    if (!skel.slides || skel.slides.length === 0) {
        alert(window.__t ? window.__t('outline_empty_slides', 'Please add at least one slide before generating.') : 'Please add at least one slide before generating.');
        return;
    }

    skel.slides.forEach(slide => {
        if (slide.key_points) {
            slide.key_points = slide.key_points.filter(p => p && p.trim() !== '');
        }
    });

    if (activeGenerateButton) {
        activeGenerateButton.disabled = true;
        activeGenerateButton.classList.add('is-generating');
    }

    if (window.startFinalGeneration) {
        window.startFinalGeneration(skel);
    }
}

function bindOutlineBubbleActions(container) {
    const outlineDom = getOutlineDom(container);

    if (outlineDom.addSlideButton && !outlineDom.addSlideButton.dataset.boundOutlineAction) {
        outlineDom.addSlideButton.dataset.boundOutlineAction = 'true';
        outlineDom.addSlideButton.addEventListener('click', (e) => {
            e.preventDefault();
            addBlankSlide();
        });
    }

    if (outlineDom.generateButton && !outlineDom.generateButton.dataset.boundOutlineAction) {
        outlineDom.generateButton.dataset.boundOutlineAction = 'true';
        outlineDom.generateButton.addEventListener('click', handleOutlineGenerateRequest);
    }
}

function createFollowUpOutlineContainer() {
    const container = document.createElement('div');
    container.className = 'outline-container-local hidden';
    container.innerHTML = `
        <div class="seamless-outline-list" data-outline-slides></div>
        <div class="outline-suggested-chips" data-outline-chips></div>
        <div class="outline-bubble-footer">
            <button type="button" class="outline-btn-ghost" data-outline-add-slide>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Add Section
            </button>
            <button type="button" class="outline-generate-btn" data-outline-generate>
                <span class="outline-generate-text" data-i18n="generate_outline_slides">Create Presentation</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
        </div>
    `;

    bindOutlineBubbleActions(container);
    return container;
}

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
    ['tone', 'audience', 'density'].forEach(type => {
        const select = document.getElementById(`outline-${type}-select`);
        const trigger = document.getElementById(`btn-outline-${type}-dropdown`);
        if (select && trigger) {
            const val = select.value;
            const activeItem = document.querySelector(`#outline-${type}-dropdown-menu .dropdown-item[data-value="${val}"]`);
            const labelSpan = trigger.querySelector('.trigger-label');
            if (activeItem && labelSpan) {
                // Keep the exact data-i18n translation key to support dynamic translations
                if (activeItem.getAttribute('data-i18n')) {
                    labelSpan.setAttribute('data-i18n', activeItem.getAttribute('data-i18n'));
                } else {
                    labelSpan.removeAttribute('data-i18n');
                }
                labelSpan.textContent = activeItem.textContent;

                // Toggle active styling
                document.querySelectorAll(`#outline-${type}-dropdown-menu .dropdown-item`).forEach(btn => {
                    btn.classList.toggle('active', btn === activeItem);
                });
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Custom Sidebar Select Dropdowns
    ['tone', 'audience', 'density'].forEach(type => {
        const container = document.getElementById(`outline-${type}-dropdown-container`);
        if (!container) return;

        const trigger = document.getElementById(`btn-outline-${type}-dropdown`);
        const menu = document.getElementById(`outline-${type}-dropdown-menu`);
        const select = document.getElementById(`outline-${type}-select`);

        if (trigger && menu && select) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close other custom menus
                document.querySelectorAll('.outline-custom-dropdown .dropdown-menu').forEach(otherMenu => {
                    if (otherMenu !== menu) {
                        otherMenu.classList.add('hidden');
                        otherMenu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
                    }
                });

                const isHidden = menu.classList.toggle('hidden');
                trigger.setAttribute('aria-expanded', !isHidden);
            });

            menu.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = item.getAttribute('data-value');
                    select.value = val;

                    // Dispatch change event to notify skeleton builder
                    select.dispatchEvent(new Event('change'));

                    syncCustomDropdowns();
                    menu.classList.add('hidden');
                    trigger.setAttribute('aria-expanded', 'false');
                });
            });
        }
    });

    // Close custom dropdowns on document click
    document.addEventListener('click', () => {
        document.querySelectorAll('.outline-custom-dropdown .dropdown-menu').forEach(menu => {
            menu.classList.add('hidden');
            menu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
        });
    });

    bindOutlineBubbleActions(document.getElementById('outline-container'));

    // Back to Chat button
    const btnBack = document.getElementById('btn-outline-back');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
            if (!confirm(msg)) return;

            // Fix #6: Abort any in-flight skeleton or generation fetch
            if (window._activeGenController) {
                window._activeGenController.abort();
                window._activeGenController = null;
            }

            // Hide container so beforeunload doesn't fire a duplicate warning
            const container = getActiveOutlineContainer();
            if (container) container.classList.add('hidden');

            // Cleanly return to the main menu with a pristine Home URL (no hashes)
            window.location.href = window.location.origin + window.location.pathname;
        });
    }

    // Backdrop click closes the drawer
    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop && btnBack) {
        backdrop.addEventListener('click', () => {
            btnBack.click();
        });
    }

    // Edge tab opens/closes the drawer
    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) {
        edgeTab.addEventListener('click', () => {
            if (edgeTab.classList.contains('is-open')) {
                const btnBack = document.getElementById('btn-outline-back');
                if (btnBack) btnBack.click();
            } else if (window.outlineEditorState.skeleton) {
                // There is a draft — resume it normally
                resumeOutlineEditor();
            } else {
                // No draft generated yet — open the panel showing ONLY the empty state
                const container = document.getElementById('outline-container');
                if (container) container.classList.remove('hidden');

                // Show empty state, hide all editing UI
                const emptyState = document.getElementById('outline-empty-state');
                if (emptyState) emptyState.classList.remove('hidden');
                document.querySelector('.outline-sidebar')?.style.setProperty('display', 'none');
                document.querySelector('.outline-main-header')?.style.setProperty('display', 'none');
                document.getElementById('legacy-outline-title-input')?.style.setProperty('display', 'none');
                document.querySelector('.outline-floating-footer')?.style.setProperty('display', 'none');

                edgeTab.classList.add('is-open');
                const tabText = edgeTab.querySelector('span');
                if (tabText) tabText.textContent = window.__t ? window.__t('close_draft', 'Close draft') : 'Close draft';

                // Apply translations so the empty state shows the correct language
                if (window.__applyTranslations) window.__applyTranslations();
            }
        });
    }
});
