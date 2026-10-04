(function registerOutlineContainerUi(global) {
    'use strict';

    /** @typedef {{
     *   document: Document,
     *   getState: () => object,
     *   addBlankSlide: () => void,
     *   translate: (key: string, fallback: string) => string,
     *   alert: (message: string) => void,
     *   startFinalGeneration: (skeleton: object) => void,
     * }} OutlineContainerUiDependencies
     */

    /** Creates the outline chat container helpers without owning outline state. @param {OutlineContainerUiDependencies} dependencies */
    function createOutlineContainerUi(dependencies) {
        return {
            scrollToBottom: force => scrollToBottom(dependencies, force),
            getActiveOutlineContainer: () => getActiveOutlineContainer(dependencies),
            getOutlineDom: container => getOutlineDom(dependencies, container),
            clearOutlineDom: container => clearOutlineDom(dependencies, container),
            mountActiveOutlineContainer: container => mountActiveOutlineContainer(dependencies, container),
            bindOutlineBubbleActions: container => bindOutlineBubbleActions(dependencies, container),
            createFollowUpOutlineContainer: () => createFollowUpOutlineContainer(dependencies)
        };
    }

    /** Scrolls the chat viewport only when forced or already near its bottom. @param {OutlineContainerUiDependencies} dependencies @param {boolean} force */
    function scrollToBottom(dependencies, force = false) {
        const chatScreen = dependencies.document.getElementById('chat-screen');
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

    /** Returns the active chat outline container, falling back to the original shell. @param {OutlineContainerUiDependencies} dependencies */
    function getActiveOutlineContainer(dependencies) {
        const activeContainer = dependencies.getState()?.activeContainer;
        if (activeContainer && dependencies.document.body.contains(activeContainer)) {
            return activeContainer;
        }

        return dependencies.document.getElementById('outline-container');
    }

    /** Resolves the legacy and data-attribute DOM hooks for one outline bubble. @param {OutlineContainerUiDependencies} dependencies @param {Element} [container] */
    function getOutlineDom(dependencies, container = getActiveOutlineContainer(dependencies)) {
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

    /** Clears slide and suggestion children in the selected outline bubble. @param {OutlineContainerUiDependencies} dependencies @param {Element} [container] */
    function clearOutlineDom(dependencies, container) {
        const outlineDom = getOutlineDom(dependencies, container);
        if (outlineDom.slidesContainer) outlineDom.slidesContainer.innerHTML = '';
        if (outlineDom.chipsContainer) outlineDom.chipsContainer.innerHTML = '';
    }

    /** Records the current bubble in the existing shared outline state. @param {OutlineContainerUiDependencies} dependencies @param {Element} container */
    function mountActiveOutlineContainer(dependencies, container) {
        const { document: doc, getState } = dependencies;
        const fallbackContainer = doc.getElementById('outline-container');
        getState().activeContainer = container && doc.body.contains(container)
            ? container
            : fallbackContainer;
        return getOutlineDom(dependencies, getState().activeContainer);
    }

    /** Copies legacy form values into the live skeleton and starts generation. @param {OutlineContainerUiDependencies} dependencies */
    function handleOutlineGenerateRequest(dependencies) {
        const activeGenerateButton = getOutlineDom(dependencies).generateButton;
        if (activeGenerateButton && activeGenerateButton.disabled) return;

        const skel = dependencies.getState().skeleton;
        if (!skel) return;

        const { document: doc } = dependencies;
        skel.topic = doc.getElementById('outline-title-input').value;
        skel.tone = doc.getElementById('outline-tone-select').value;
        skel.audience = doc.getElementById('outline-audience-select').value;
        skel.density = doc.getElementById('outline-density-select').value;

        const subtitleInput = doc.getElementById('outline-subtitle-input');
        if (subtitleInput) skel.subtitle_context = subtitleInput.value.trim();

        if (!skel.slides || skel.slides.length === 0) {
            dependencies.alert(dependencies.translate('outline_empty_slides', 'Please add at least one slide before generating.'));
            return;
        }

        skel.slides.forEach(slide => {
            if (slide.key_points) {
                slide.key_points = slide.key_points.filter(point => point && point.trim() !== '');
            }
        });

        if (activeGenerateButton) {
            activeGenerateButton.disabled = true;
            activeGenerateButton.classList.add('is-generating');
        }

        dependencies.startFinalGeneration(skel);
    }

    /** Binds the same add-slide and generate actions used by chat outline bubbles. @param {OutlineContainerUiDependencies} dependencies @param {Element} container */
    function bindOutlineBubbleActions(dependencies, container) {
        const outlineDom = getOutlineDom(dependencies, container);

        if (outlineDom.addSlideButton && !outlineDom.addSlideButton.dataset.boundOutlineAction) {
            outlineDom.addSlideButton.dataset.boundOutlineAction = 'true';
            outlineDom.addSlideButton.addEventListener('click', event => {
                event.preventDefault();
                dependencies.addBlankSlide();
            });
        }

        if (outlineDom.generateButton && !outlineDom.generateButton.dataset.boundOutlineAction) {
            outlineDom.generateButton.dataset.boundOutlineAction = 'true';
            outlineDom.generateButton.addEventListener('click', () => handleOutlineGenerateRequest(dependencies));
        }
    }

    /** Creates a follow-up outline bubble using the legacy markup and action binding. @param {OutlineContainerUiDependencies} dependencies */
    function createFollowUpOutlineContainer(dependencies) {
        const container = dependencies.document.createElement('div');
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

        bindOutlineBubbleActions(dependencies, container);
        return container;
    }

    global.AedosOutlineContainerUi = { createOutlineContainerUi };
})(window);
