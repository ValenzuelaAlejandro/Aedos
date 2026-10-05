(function registerProceedFlow(global) {
    'use strict';

    /**
     * @typedef {Object} ProceedFlowDependencies
     * @property {Window} window Existing application window and compatibility state.
     * @property {Document} document Existing application document.
     */

    /** Create the existing outline-proceed UI and final-generation handoff. @param {ProceedFlowDependencies} deps */
    function createProceedFlow({ window, document }) {
        // eslint-disable-next-line complexity -- Keep the proceed message and its interval lifecycle together.
        return function handleProceedFlow(finalSkeleton) {
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
                let finalSkeletonObj = (window.outlineEditorState && window.outlineEditorState.skeleton)
                    ? window.outlineEditorState.skeleton
                    : finalSkeleton;
                if (window._backupSkeleton && (!finalSkeletonObj || !finalSkeletonObj.slides || finalSkeletonObj.slides.length === 0)) {
                    if (window.outlineEditorState) window.outlineEditorState.skeleton = window._backupSkeleton;
                    finalSkeletonObj = window._backupSkeleton;
                }
                window.startFinalGeneration(finalSkeletonObj);
            }
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createProceedFlow = createProceedFlow;
})(window);
