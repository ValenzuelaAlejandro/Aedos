(function registerApprovedOutlineProceed(global) {
    'use strict';

    /**
     * @typedef {Object} ApprovedOutlineProceedDependencies
     * @property {Window} window Existing app compatibility state.
     * @property {Document} document Existing app document.
     * @property {Object} generationState Shared generation state.
     * @property {HTMLInputElement|null} temaInput Existing topic input.
     * @property {typeof FormData} FormData Browser FormData constructor.
     * @property {Function} clearTimeout Existing timer API.
     */

    /** Create the existing approved-outline shortcut and its progress UI. @param {ApprovedOutlineProceedDependencies} deps */
    // eslint-disable-next-line max-lines-per-function -- The factory only closes over its dependency record.
    function createApprovedOutlineProceed(deps) {
        const { window, document, generationState, temaInput, FormData, clearTimeout } = deps;

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
                const aiBody = latestAiMessage.querySelector('.chat-ai-body');
                if (aiBody) {
                    aiBody.querySelectorAll('.chat-proceed-message').forEach(element => element.remove());
                    if (window.AedosThinking) {
                        window.AedosThinking.show(aiBody, {
                            label: window.__t ? window.__t('chat_proceeding_1', 'Analyzing request…') : 'Analyzing request…',
                            stage: generationState.proModeEnabled ? 'stage1' : 'flash'
                        });
                    }
                }
            }

            document.body.classList.remove('split-outline-active');
            if (window.startFinalGeneration) window.startFinalGeneration(skeleton);
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createApprovedOutlineProceed = createApprovedOutlineProceed;
})(window);
