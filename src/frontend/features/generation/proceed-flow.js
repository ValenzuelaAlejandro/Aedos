(function registerProceedFlow(global) {
    'use strict';

    /**
     * @typedef {Object} ProceedFlowDependencies
     * @property {Window} window Existing application window and compatibility state.
     * @property {Document} document Existing application document.
     */

    /** Create the existing outline-proceed UI and final-generation handoff. @param {ProceedFlowDependencies} deps */
    function createProceedFlow({ window, document }) {
        return function handleProceedFlow(finalSkeleton) {
            const aiMessages = document.querySelectorAll('.chat-msg-ai');
            const latestAiMessage = aiMessages[aiMessages.length - 1];
            const aiBody = latestAiMessage?.querySelector('.chat-ai-body');
            if (aiBody) window.AedosThinking?.show(aiBody, {
                label: window.__t ? window.__t('chat_proceeding_1', 'Analyzing request…') : 'Analyzing request…',
                stage: 'stage1'
            });

            document.body.classList.remove('split-outline-active');
            if (window.startFinalGeneration) {
                let finalSkeletonObj = (window.outlineEditorState && window.outlineEditorState.skeleton)
                    ? window.outlineEditorState.skeleton
                    : finalSkeleton;
                if (window._backupSkeleton && (!finalSkeletonObj || !finalSkeletonObj.slides || finalSkeletonObj.slides.length === 0)) {
                    if (window.outlineEditorState) window.outlineEditorState.skeleton = window._backupSkeleton;
                    finalSkeletonObj = window._backupSkeleton;
                }
                if (Array.isArray(finalSkeletonObj?.slides)) window.AedosCreditsUI?.setSlideCount(Math.min(15, finalSkeletonObj.slides.length));
                window.startFinalGeneration(finalSkeletonObj);
            }
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createProceedFlow = createProceedFlow;
})(window);
