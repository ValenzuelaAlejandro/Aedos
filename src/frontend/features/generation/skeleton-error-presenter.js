(function registerSkeletonErrorPresenter(global) {
    'use strict';

    /**
     * @typedef {Object} SkeletonErrorPresenterDependencies
     * @property {Window} window Existing application globals and localization.
     * @property {Document} document Existing conversation document.
     * @property {Object} generationState Shared generation state.
     * @property {Function} toggleGenerateLoading Existing loading control.
     * @property {HTMLElement|null} errorMessage Existing error message node.
     * @property {Function} showErrorModal Existing error modal action.
     * @property {Function} escapeHtml Existing shared HTML escaping helper.
     */

    /** Create the existing skeleton-request error path. @param {SkeletonErrorPresenterDependencies} deps */
    function createSkeletonErrorPresenter(deps) {
        const { window, document, generationState, toggleGenerateLoading, errorMessage, showErrorModal, escapeHtml } = deps;

        // eslint-disable-next-line complexity -- Preserve the current error UI and state-cleanup ordering as one handler.
        return function handleSkeletonError(error, controller) {
            if (generationState.skeletonController && controller !== generationState.skeletonController) {
                console.log('Ignoring obsolete skeleton generation error/abort');
                return;
            }
            toggleGenerateLoading(false);
            if (window.outlineEditorState) window.outlineEditorState.isLoading = false;

            const isAbort = error.name === 'AbortError' || error.message?.toLowerCase().includes('abort');
            const aiBubbles = document.querySelectorAll('.chat-msg-ai');
            const latestAiBubble = aiBubbles[aiBubbles.length - 1];

            if (latestAiBubble) {
                const thinking = latestAiBubble.querySelector('.chat-thinking');
                if (thinking) thinking.classList.add('hidden');
                const aiBody = latestAiBubble.querySelector('.chat-ai-body');
                if (aiBody) {
                    if (window.AedosThinking) {
                        const preserveThinking =
                            !isAbort &&
                            window.AedosThinking.hasReasoning &&
                            window.AedosThinking.hasReasoning(aiBody);
                        if (preserveThinking) window.AedosThinking.collapse(aiBody);
                        else window.AedosThinking.hide(aiBody);
                    }

                    aiBody.querySelectorAll('.chat-proceed-message, .chat-error-message, .chat-cancelled-message').forEach(el => el.remove());
                    const errEl = document.createElement('div');
                    if (isAbort) {
                        errEl.className = 'chat-cancelled-message';
                        const cancelText = window.__t ? window.__t('generation_cancelled', 'Generation cancelled by user') : 'Generation cancelled by user';
                        errEl.textContent = cancelText;
                    } else {
                        errEl.className = 'chat-error-message';
                        errEl.style.cssText = 'color: var(--danger); font-weight: 500; display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem;';
                        errEl.innerHTML = `<span>⚠</span> <span>${escapeHtml(error.message)}</span>`;
                    }
                    aiBody.appendChild(errEl);
                    if (window.gsap) window.gsap.fromTo(errEl, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3 });
                }
            } else {
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
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createSkeletonErrorPresenter = createSkeletonErrorPresenter;
})(window);
