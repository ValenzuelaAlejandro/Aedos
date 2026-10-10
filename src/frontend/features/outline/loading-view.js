(function registerOutlineLoadingView(global) {
    'use strict';

    /** @typedef {object} OutlineLoadingDependencies
     * @property {object} state Shared outline store, passed explicitly by the orchestrator.
     * @property {() => Array<object>} getAttachedFiles
     * @property {(files: Array<object>) => void} setAttachedFiles
     * @property {number|undefined} chipsTimeout
     * @property {(file: object) => string} renderFileChip
     * @property {(key: string, fallback: string) => string} [translate]
     * @property {Function} [escapeHtml]
     * @property {object} [gsap]
     * @property {object} [thinkingPanel]
     * @property {Function} getActiveOutlineContainer
     * @property {Function} mountActiveOutlineContainer
     * @property {Function} bindOutlineBubbleActions
     * @property {Function} getOutlineDom
     * @property {Function} clearOutlineDom
     * @property {Function} createFollowUpOutlineContainer
     * @property {Function} scrollToBottom
     */

    /** Displays the existing loading/chat transition without owning outline state. @param {number} slideCount @param {OutlineLoadingDependencies} dependencies */

    function clearFreshOutline(dependencies, window) {
        document.querySelectorAll('.historical-outline-summary').forEach(el => el.remove());
        const globalOutline = document.getElementById('outline-container');
        dependencies.mountActiveOutlineContainer(globalOutline);
        dependencies.bindOutlineBubbleActions(globalOutline);
        const slidesContainer = dependencies.getOutlineDom(globalOutline).slidesContainer;
        if (slidesContainer) slidesContainer.innerHTML = '';
        const chipsContainer = dependencies.getOutlineDom(globalOutline).chipsContainer;
        if (chipsContainer) {
            chipsContainer.innerHTML = '';
            if (window._chipsRenderTimeout) clearTimeout(window._chipsRenderTimeout);
        }
    }

    function setLoadingControls() {
        const btnGenerate = document.getElementById('btn-generate');
        const btnLang = document.getElementById('btn-lang-dropdown');
        if (btnGenerate) {
            btnGenerate.classList.add('is-generating');
            btnGenerate.disabled = false;
        }
        if (btnLang) btnLang.disabled = true;
    }

    function capturePromptAndFiles(window) {
        const inputEl = document.getElementById('w-tema');
        const promptText = inputEl?.value?.trim() || '';
        if (inputEl) {
            inputEl.value = '';
            inputEl.style.height = '';
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const capturedFiles = (window._attachedFiles && window._attachedFiles.length > 0)
            ? window._attachedFiles.slice()
            : [];
        if (capturedFiles.length > 0) {
            window._attachedFiles = [];
            const attachmentPreview = document.getElementById('attachment-preview-container');
            if (attachmentPreview) {
                attachmentPreview.innerHTML = '';
                attachmentPreview.classList.add('hidden');
            }
        }
        return { promptText, capturedFiles };
    }

    function transitionHomeToChat(window) {
        const chatScreen = document.getElementById('chat-screen');
        if (chatScreen) chatScreen.classList.add('chat-mode');
        const heroZone = document.getElementById('hero-zone');
        if (heroZone) heroZone.classList.add('fade-out');

        const pills = document.getElementById('suggestion-pills-row');
        if (pills) { pills.style.transition = 'opacity 0.3s'; pills.style.opacity = '0'; pills.style.pointerEvents = 'none'; }
        const microcopy = document.querySelector('.app-microcopy');
        if (microcopy) { microcopy.style.transition = 'opacity 0.3s'; microcopy.style.opacity = '0'; }
        const counter = document.querySelector('.chat-counter-row');
        if (counter) { counter.style.transition = 'opacity 0.3s'; counter.style.opacity = '0'; }
        const composer = document.getElementById('w-tema');
        const composerLabel = document.querySelector('label[for="w-tema"]');
        const placeholder = window.__t ? window.__t('outline_chat_placeholder', 'Ask for changes to this outline…') : 'Ask for changes to this outline…';
        if (composer) {
            composer.setAttribute('data-i18n-placeholder', 'outline_chat_placeholder');
            composer.placeholder = placeholder;
        }
        if (composerLabel) {
            composerLabel.setAttribute('data-i18n', 'outline_chat_placeholder');
            composerLabel.textContent = placeholder;
        }
    }

    function prepareLoadingState(dependencies, window) {
        window.outlineEditorState.isLoading = true;
        const isFollowUp = !!window.outlineEditorState.skeleton;
        if (!isFollowUp) clearFreshOutline(dependencies, window);
        setLoadingControls();
        const { promptText, capturedFiles } = capturePromptAndFiles(window);
        transitionHomeToChat(window);
        return { promptText, capturedFiles };
    }

    function appendFollowUpMessages(convZone, promptText, capturedFiles, dependencies, window) {
        const _fileBubbleChipHtml = dependencies.renderFileChip;
        // Append new user message bubble
                    const userBubble = document.createElement('div');
                    userBubble.className = 'chat-msg chat-msg-user';

                    let bubbleContent = '';
                    if (capturedFiles.length > 0) {
                        const fileItemsHtml = capturedFiles
                            .map(f => `<div class="chat-bubble-file-item">${_fileBubbleChipHtml(f)}</div>`)
                            .join('');
                        bubbleContent += `<div class="chat-bubble-files-container">${fileItemsHtml}</div>`;
                    }
                    if (promptText) {
                        bubbleContent += `<span>${window.escapeHtml(promptText)}</span>`;
                    }
                    userBubble.innerHTML = bubbleContent;
                    convZone.appendChild(userBubble);

                    // GSAP premium entrance animation
                    if (window.gsap) {
                        window.gsap.fromTo(userBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
                    }

                    // Append new AI message bubble with active loader
                    const aiBubble = document.createElement('div');
                    aiBubble.className = 'chat-msg chat-msg-ai chat-outline-response';
                    aiBubble.innerHTML = `
                        <div class="chat-ai-avatar"></div>
                        <div class="chat-ai-body">
                            <!-- Thinking panel and orb avatar are attached when generation starts. -->
                        </div>
                    `;
                    convZone.appendChild(aiBubble);

                    if (window.gsap) {
                        window.gsap.fromTo(aiBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', delay: 0.1 });
                    }

                    // Attach the compact progress panel right away so the user
                    // sees the current generation stage from the start.
                    if (window.AedosThinking) {
                        const aiBody = aiBubble.querySelector('.chat-ai-body');
                        if (aiBody) {
                            window.AedosThinking.show(aiBody, {
                                label: window.__t ? window.__t('chat_stage_analyze', 'Analyzing your request…') : 'Analyzing your request…',
                                stage: 'stage1'
                            });
                        }
                    }

        return aiBubble;
    }

    function archivePreviousOutline(dependencies, window) {
        const {
            getActiveOutlineContainer,
            getOutlineDom,
            clearOutlineDom
        } = dependencies;
        // Archive and freeze the previous outline state into a gorgeous static summary
                    const outlineContainer = getActiveOutlineContainer();
                    if (outlineContainer) {
                        const slidesContainer = getOutlineDom(outlineContainer).slidesContainer;
                        if (slidesContainer && !outlineContainer.classList.contains('hidden')) {
                            // Create a static read-only snapshot
                            const staticSummary = document.createElement('div');
                            staticSummary.className = 'historical-outline-summary';

                            const slideItems = slidesContainer.querySelectorAll('.seamless-slide-item');
                            slideItems.forEach(item => {
                                const num = item.querySelector('.seamless-slide-number')?.textContent || '';
                                const title = item.querySelector('.outline-slide-title')?.value || '';
                                const points = Array.from(item.querySelectorAll('.outline-point-input')).map(input => input.value);

                                const slideEl = document.createElement('div');
                                slideEl.className = 'historical-slide-item';
                                slideEl.innerHTML = `
                                    <div class="historical-slide-number">${window.escapeHtml(num)}</div>
                                    <div class="historical-slide-title">${window.escapeHtml(title)}</div>
                                    <div class="historical-points-list">
                                        ${points.map(pt => `
                                            <div class="historical-point-item">
                                                <span class="historical-point-bullet">-</span>
                                                <span class="historical-point-text">${window.escapeHtml(pt)}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                `;
                                staticSummary.appendChild(slideEl);
                            });

                            // Replace the active editor container in the old AI bubble with the static read-only snapshot
                            const oldParent = outlineContainer.parentNode;
                            if (oldParent) {
                                oldParent.insertBefore(staticSummary, outlineContainer);

                                if (window.gsap) {
                                    window.gsap.fromTo(staticSummary, { opacity: 0 }, { opacity: 0.5, duration: 0.3 });
                                }
                            }
                        }

                        // Retire the previous interactive host without reparenting the
                        // same outline DOM subtree into the next bubble.
                        clearOutlineDom(outlineContainer);
                        if (outlineContainer.id === 'outline-container') {
                            outlineContainer.classList.add('hidden');
                        } else {
                            outlineContainer.remove();
                        }
                    }
    }

    function renderFollowUpConversation(convZone, context, dependencies, window) {
        const aiBubble = appendFollowUpMessages(convZone, context.promptText, context.capturedFiles, dependencies, window);
        archivePreviousOutline(dependencies, window);
        const followUpOutlineContainer = dependencies.createFollowUpOutlineContainer();
        aiBubble.querySelector('.chat-ai-body').appendChild(followUpOutlineContainer);
        dependencies.mountActiveOutlineContainer(followUpOutlineContainer);
    }

    function renderInitialConversation(context, dependencies, window) {
        const { capturedFiles, promptText } = context;
        const _fileBubbleChipHtml = dependencies.renderFileChip;
        const { mountActiveOutlineContainer, bindOutlineBubbleActions } = dependencies;
        // First loading state: populate the static placeholders
                    const firstUserBubble = document.getElementById('chat-user-bubble');
                    const userTextEl = document.getElementById('chat-user-text');
                    if (userTextEl) {
                        userTextEl.textContent = promptText;
                    }
                    if (firstUserBubble && capturedFiles.length > 0) {
                        // Remove any previously injected file chips
                        firstUserBubble.querySelectorAll('.chat-bubble-files-container').forEach(el => el.remove());
                        const filesContainer = document.createElement('div');
                        filesContainer.className = 'chat-bubble-files-container';
                        capturedFiles.forEach(f => {
                            const item = document.createElement('div');
                            item.className = 'chat-bubble-file-item';
                            item.innerHTML = _fileBubbleChipHtml(f);
                            filesContainer.appendChild(item);
                        });
                        // Insert the files BEFORE the text span so they stack above it outside the bubble
                        firstUserBubble.insertBefore(filesContainer, userTextEl);
                    }
                    if (firstUserBubble && window.gsap) {
                        window.gsap.fromTo(firstUserBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
                    }
                    const thinking = document.getElementById('chat-thinking');
                    if (thinking) {
                        thinking.classList.remove('hidden');
                        if (window.gsap) {
                            const firstAiBubble = document.getElementById('chat-ai-response');
                            if (firstAiBubble) {
                                window.gsap.fromTo(firstAiBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', delay: 0.1 });
                            }
                        }
                    }

                    const globalOutline = document.getElementById('outline-container');
                    if (globalOutline) {
                        mountActiveOutlineContainer(globalOutline);
                        bindOutlineBubbleActions(globalOutline);
                    }
    }

    function disableLoadingControls(dependencies) {
        const outlineDom = dependencies.getOutlineDom();
        const btnGen = outlineDom.generateButton;
        const btnAdd = outlineDom.addSlideButton;
        if (btnGen) btnGen.disabled = true;
        if (btnAdd) btnAdd.disabled = true;
    }

    /** Displays the existing loading/chat transition without owning outline state. @param {number} slideCount @param {OutlineLoadingDependencies} dependencies */
    function showOutlineEditorLoading(slideCount = 8, dependencies) {
        const window = global.AedosOutlineLoadingLegacyBridge.createLegacyWindow(dependencies);
        const context = prepareLoadingState(dependencies, window);
        const convZone = document.getElementById('conversation-zone');
        if (convZone) {
            convZone.classList.remove('hidden');
            convZone.classList.add('visible');
            const isFollowUp = !!dependencies.state.skeleton;
            if (isFollowUp) {
                renderFollowUpConversation(convZone, context, dependencies, window);
            } else {
                renderInitialConversation(context, dependencies, window);
            }
            dependencies.scrollToBottom(true);
        }
        disableLoadingControls(dependencies);
    }


    global.AedosOutlineLoadingView = Object.freeze({ showOutlineEditorLoading });
})(window);
