(function registerApprovedOutlineProceed(global) {
    'use strict';

    /**
     * @typedef {Object} ApprovedOutlineProceedDependencies
     * @property {Window} window Existing app compatibility state.
     * @property {Document} document Existing app document.
     * @property {Object} generationState Shared generation state.
     * @property {HTMLInputElement|null} temaInput Existing topic input.
     * @property {typeof FormData} FormData Browser FormData constructor.
     * @property {Function} setTimeout Existing timer API.
     * @property {Function} clearTimeout Existing timer API.
     * @property {Function} setInterval Existing timer API.
     * @property {Function} clearInterval Existing timer API.
     */

    /** Create the existing approved-outline shortcut and its progress UI. @param {ApprovedOutlineProceedDependencies} deps */
    // eslint-disable-next-line max-lines-per-function -- The factory only closes over its dependency record.
    function createApprovedOutlineProceed(deps) {
        const { window, document, generationState, temaInput, FormData, setTimeout, clearTimeout, setInterval, clearInterval } = deps;

        // eslint-disable-next-line complexity, max-lines-per-function -- Keep the shortcut and its progress lifecycle in one vertical block.
        return function proceedWithCurrentOutline() {
            if (window._activeGenController) {
                console.warn('A generation is already in progress. Ignoring proceed request.');
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
                console.warn('proceedWithCurrentOutline: no outline available to proceed with.');
                return;
            }

            if (window.location.hash !== '#chat') window.navigateToChat();

            const tema = (temaInput && temaInput.value ? temaInput.value.trim() : '') ||
                (window.__t ? window.__t('default_document_prompt', 'Analyze this document and create a presentation') : 'Analyze this document and create a presentation');
            const requestData = {
                tema,
                mode: 'chat',
                ...(generationState.targetLanguage !== 'auto' ? { language: generationState.targetLanguage } : {})
            };
            requestData.currentSkeleton = JSON.stringify(skeleton);

            let bodyData;
            const headers = {};
            if (window._attachedFiles && window._attachedFiles.length > 0) {
                const formData = new FormData();
                formData.append('tema', requestData.tema);
                if (requestData.mode) formData.append('mode', requestData.mode);
                if (requestData.language) formData.append('language', requestData.language);
                if (requestData.slides !== undefined) formData.append('slides', requestData.slides);
                if (requestData.currentSkeleton) formData.append('currentSkeleton', requestData.currentSkeleton);
                window._attachedFiles.forEach(file => formData.append('files', file));
                bodyData = formData;
            } else {
                headers['Content-Type'] = 'application/json';
                bodyData = JSON.stringify(requestData);
            }

            window._pendingGenerateBodyData = bodyData;
            window._pendingGenerateHeaders = headers;

            const btnGen = document.getElementById('btn-outline-generate');
            const btnAdd = document.getElementById('btn-outline-add-slide');
            if (btnGen) btnGen.disabled = true;
            if (btnAdd) btnAdd.disabled = true;

            const chipsContainer = document.getElementById('outline-suggested-chips');
            if (chipsContainer) {
                chipsContainer.innerHTML = '';
                if (window._chipsRenderTimeout) {
                    clearTimeout(window._chipsRenderTimeout);
                    window._chipsRenderTimeout = null;
                }
            }
            document.querySelectorAll('.suggested-chip').forEach(element => { element.disabled = true; });

            const aiMessages = document.querySelectorAll('.chat-msg-ai');
            const latestAiMessage = aiMessages[aiMessages.length - 1];
            if (latestAiMessage) {
                const thinking = latestAiMessage.querySelector('.chat-thinking');
                if (thinking) thinking.classList.add('hidden');
                const aiBody = latestAiMessage.querySelector('.chat-ai-body');
                if (aiBody) {
                    aiBody.querySelectorAll('.chat-proceed-message').forEach(element => element.remove());
                    const progressMsg = document.createElement('div');
                    progressMsg.className = 'chat-proceed-message';
                    progressMsg.style.cssText = 'padding: 0.8rem 1rem; color: var(--text); font-weight: 500; font-family: var(--font-body); display: flex; align-items: center; gap: 0.5rem;';
                    const textSpan = document.createElement('span');
                    textSpan.textContent = window.__t ? window.__t('chat_proceeding_1', 'Analyzing request...') : 'Analyzing request...';
                    progressMsg.innerHTML = '<span style="color: var(--accent); font-size: 1.2rem; display: inline-block;" class="loading-spinner">⟳</span>';
                    progressMsg.appendChild(textSpan);
                    aiBody.appendChild(progressMsg);

                    if (window.AedosThinking) {
                        window.AedosThinking.show(aiBody, {
                            label: window.__t ? window.__t('chat_proceeding_1', 'Analyzing request…') : 'Analyzing request…',
                            stage: generationState.proModeEnabled ? 'stage1' : 'flash'
                        });
                    }
                    if (window.gsap) window.gsap.fromTo(progressMsg, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
                    const spinner = progressMsg.querySelector('.loading-spinner');
                    if (spinner && spinner.animate) {
                        spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1500, iterations: Infinity });
                    }

                    const messages = [
                        window.__t ? window.__t('chat_proceeding_2', 'Drafting slides...') : 'Drafting slides...',
                        window.__t ? window.__t('chat_proceeding_3', 'Structuring narrative...') : 'Structuring narrative...',
                        window.__t ? window.__t('chat_proceeding_4', 'Finding visual assets...') : 'Finding visual assets...',
                        window.__t ? window.__t('chat_proceeding_5', 'Polishing layout...') : 'Polishing layout...'
                    ];
                    let messageIndex = 0;
                    if (window._proceedMsgInterval) clearInterval(window._proceedMsgInterval);
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
                                    textSpan.textContent = messages[messageIndex % messages.length];
                                    window.gsap.fromTo(textSpan, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
                                    messageIndex++;
                                }
                            });
                        } else {
                            textSpan.style.opacity = 0;
                            setTimeout(() => {
                                textSpan.textContent = messages[messageIndex % messages.length];
                                textSpan.style.opacity = 1;
                                messageIndex++;
                            }, 200);
                        }
                    }, 2500);
                }
            }

            document.body.classList.remove('split-outline-active');
            if (window.startFinalGeneration) window.startFinalGeneration(skeleton);
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createApprovedOutlineProceed = createApprovedOutlineProceed;
})(window);
