(function registerOutlineStreaming(global) {
    'use strict';

    /** @typedef {{
     *   document: Document,
     *   getState: () => object,
     *   getActiveContainer: () => Element,
     *   mountActiveContainer: (container: Element) => object,
     *   getOutlineDom: (container?: Element) => object,
     *   getChipsTimeout: () => number|undefined,
     *   scrollToBottom: () => void,
     *   renderSlides: () => void,
     *   renderChips: (skeleton: object) => void,
     *   validateGenerateButton: () => void,
     * }} OutlineStreamingDependencies
     */

    /** Creates the prepare/render/finalize lifecycle around the shared outline state. @param {OutlineStreamingDependencies} dependencies */
    function createOutlineStreaming(dependencies) {
        return {
            prepareOutlineStreaming: mode => prepareOutlineStreaming(mode, dependencies),
            renderStreamingOutline: skeleton => renderStreamingOutline(skeleton, dependencies),
            finalizeStreamingOutline: skeleton => finalizeStreamingOutline(skeleton, dependencies),
            stopOutlineGeneration: () => stopOutlineGeneration(dependencies)
        };
    }

    /** Initializes the streamed outline controls and clears the active bubble. @param {string} mode @param {OutlineStreamingDependencies} dependencies */
    function prepareOutlineStreaming(mode, dependencies) {
        const { document: doc } = dependencies;
        const state = dependencies.getState();
        state.isLoading = true;
        state.skeleton = null;
        state.mode = mode;
        state.maxSlides = mode === 'pro' ? 8 : 15;

        const activeOutlineDom = dependencies.mountActiveContainer(dependencies.getActiveContainer());
        const container = activeOutlineDom.slidesContainer;
        if (container) container.innerHTML = '';

        const btnGenerate = doc.getElementById('btn-generate');
        const btnLang = doc.getElementById('btn-lang-dropdown');
        if (btnGenerate) {
            btnGenerate.classList.add('is-generating');
            btnGenerate.disabled = false;
        }
        if (btnLang) btnLang.disabled = true;

        const pills = doc.getElementById('suggestion-pills-row');
        if (pills) { pills.style.transition = 'opacity 0.3s'; pills.style.opacity = '0'; pills.style.pointerEvents = 'none'; }
        const microcopy = doc.querySelector('.app-microcopy');
        if (microcopy) { microcopy.style.transition = 'opacity 0.3s'; microcopy.style.opacity = '0'; }
        const counter = doc.querySelector('.chat-counter-row');
        if (counter) { counter.style.transition = 'opacity 0.3s'; counter.style.opacity = '0'; }

        const outlineContainer = activeOutlineDom.container;
        if (outlineContainer) outlineContainer.classList.remove('hidden');

        const chipsContainer = activeOutlineDom.chipsContainer;
        if (chipsContainer) {
            chipsContainer.innerHTML = '';
            if (dependencies.getChipsTimeout()) global.clearTimeout(dependencies.getChipsTimeout());
        }
    }

    /** Renders the partial outline in the active slide container while retaining chat scroll behavior. @param {object} partialSkeleton @param {OutlineStreamingDependencies} dependencies */
    function renderStreamingOutline(partialSkeleton, dependencies) {
        const container = dependencies.getOutlineDom().slidesContainer;
        if (!container) return;
        global.AedosOutlineStreamRenderer.renderPartialOutline(container, partialSkeleton, dependencies.scrollToBottom);
    }

    /** Copies the final outline settings into the same hidden configuration inputs. @param {object} skeleton @param {Document} doc */
    function populateOutlineInputs(skeleton, doc) {
        const titleInput = doc.getElementById('outline-title-input');
        if (titleInput) { titleInput.value = skeleton.topic || ''; titleInput.disabled = false; }
        const toneVal = skeleton.tone || 'academic';
        const toneEl = doc.getElementById('outline-tone-select');
        if (toneEl) { toneEl.value = toneVal; if (!toneEl.value) toneEl.value = 'academic'; }
        const audEl = doc.getElementById('outline-audience-select');
        if (audEl) audEl.value = skeleton.audience || 'general';
        const densEl = doc.getElementById('outline-density-select');
        if (densEl) densEl.value = skeleton.density || skeleton.text_density || 'medium';
        const subEl = doc.getElementById('outline-subtitle-input');
        if (subEl) subEl.value = skeleton.subtitle_context || '';
    }

    /** Applies the completed skeleton and reenables the outline controls in legacy order. @param {object} finalSkeleton @param {OutlineStreamingDependencies} dependencies */
    function finalizeStreamingOutline(finalSkeleton, dependencies) {
        const { document: doc } = dependencies;
        dependencies.getState().skeleton = finalSkeleton;

        // Populate hidden config tags
        populateOutlineInputs(finalSkeleton, doc);

        // Render standard slides to replace disabled textareas and bind all events (like draggable, inputs etc.)
        dependencies.renderSlides();

        // Render Suggested Action Chips Row
        dependencies.renderChips(finalSkeleton);

        // Mark loading as false and enable controls
        dependencies.getState().isLoading = false;

        // Re-enable global buttons and remove is-generating class
        const btnGenerate = doc.getElementById('btn-generate');
        if (btnGenerate) {
            btnGenerate.classList.remove('is-generating');
            btnGenerate.disabled = false;
        }
        const btnLang = doc.getElementById('btn-lang-dropdown');
        if (btnLang) btnLang.disabled = false;

        const outlineDom = dependencies.getOutlineDom();
        const btnGen = outlineDom.generateButton;
        const btnAdd = outlineDom.addSlideButton;
        if (btnGen) btnGen.disabled = false;
        if (btnAdd) btnAdd.disabled = false;

        dependencies.validateGenerateButton();
    }

    /** Stops generation and reenables the same global and outline controls. @param {OutlineStreamingDependencies} dependencies */
    function stopOutlineGeneration(dependencies) {
        const state = dependencies.getState();
        // 1. Render all slides statically right away so the user doesn't lose what was streamed so far
        if (state && state.skeleton) {
            dependencies.renderSlides();
            dependencies.renderChips(state.skeleton);
        }

        // 2. Mark loading as false and enable controls
        dependencies.getState().isLoading = false;

        // 3. Re-enable global buttons and remove is-generating class
        const btnGenerate = dependencies.document.getElementById('btn-generate');
        if (btnGenerate) {
            btnGenerate.classList.remove('is-generating');
            btnGenerate.disabled = false;
        }
        const btnLang = dependencies.document.getElementById('btn-lang-dropdown');
        if (btnLang) btnLang.disabled = false;

        const outlineDom = dependencies.getOutlineDom();
        const btnGen = outlineDom.generateButton;
        const btnAdd = outlineDom.addSlideButton;
        if (btnGen) btnGen.disabled = false;
        if (btnAdd) btnAdd.disabled = false;

        dependencies.validateGenerateButton();
    }

    global.AedosOutlineStreaming = { createOutlineStreaming };
})(window);
