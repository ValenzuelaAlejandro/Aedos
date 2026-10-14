(function registerSkeletonGeneration(global) {
    'use strict';

    /**
     * @typedef {Object} SkeletonGenerationDependencies
     * @property {Window} window Existing global compatibility surface.
     * @property {Document} document Existing document.
     * @property {HTMLElement} generateBtn Existing generate button.
     * @property {Object} generationState Existing generation state.
     * @property {Function} toggleGenerateLoading Existing loading control.
     * @property {HTMLInputElement} temaInput Existing topic field.
     * @property {HTMLElement} temaError Existing validation message.
     * @property {typeof FormData} FormData Existing multipart constructor.
     * @property {typeof AbortController} AbortController Existing abort constructor.
     * @property {Function} fetch Existing request API.
     * @property {Function} handleProceedFlow Existing outline proceed flow.
     * @property {Function} handleSkeletonError Existing error presenter.
     */

    /** Create the original skeleton request and streaming flow. @param {SkeletonGenerationDependencies} deps */
    // eslint-disable-next-line max-lines-per-function -- Keep the existing request and SSE lifecycle in order.
    function createSkeletonGeneration(deps) {
        const { window, document, generateBtn, generationState, toggleGenerateLoading, temaInput, temaError, FormData, AbortController, fetch, handleProceedFlow, handleSkeletonError } = deps;

        // eslint-disable-next-line max-lines-per-function, complexity -- Move the vertical stream unchanged.
        return async function handleGenerate() {
            // If already generating, act as a CANCEL/STOP button!
            if (generateBtn && generateBtn.classList.contains('is-generating')) {
                console.log("Stopping active generation...");
                if (generationState.skeletonController) {
                    generationState.skeletonController.abort();
                    generationState.skeletonController = null;
                }
                if (window.stopOutlineGeneration) {
                    window.stopOutlineGeneration();
                }
                toggleGenerateLoading(false);
                return;
            }
    
            // Clean up any old error or cancelled messages inside the hardcoded first AI bubble to prevent them from stacking
            const firstAiResponse = document.getElementById('chat-ai-response');
            if (firstAiResponse) {
                firstAiResponse.querySelectorAll('.chat-proceed-message, .chat-cancelled-message, .chat-error-message').forEach(el => el.remove());
            }
    
            // Abort any previous in-flight skeleton generation
            if (generationState.skeletonController) {
                generationState.skeletonController.abort();
                generationState.skeletonController = null;
            }

            const hasFiles = window._attachedFiles && window._attachedFiles.length > 0;
            if (hasFiles && !window.AedosCreditsUI?.canAttachDocuments?.()) {
                window.AedosModals.showNotice(window.__t('credits.attachmentsGeminiOnly'));
                window.AedosAttachments?.refreshAvailability?.();
                return;
            }
            // The server must reject attachments without Gemini quota or on a paid model;
            // client-side checks and model IDs are not trustworthy.
    
            // Push state immediately so the native back button works during the loading phase
            if (window.location.hash !== '#chat') {
                window.navigateToChat();
            }
    
            const tema = temaInput.value.trim();
            if (!tema && !hasFiles) {
                temaError.classList.add('visible');
                temaInput.focus();
                return;
            }
            temaError.classList.remove('visible');
    
            const finalTema = tema || (hasFiles ? (window.__t ? window.__t('default_document_prompt', 'Analyze this document and create a presentation') : 'Analyze this document and create a presentation') : '');
    
            const requestData = {
                tema: finalTema,
                mode: 'chat', // skeleton always draws from the chat rate-limit bucket
                modelId: generationState.selectedModelId || 'google/gemini-3-flash-preview',
                slides: window.AedosCreditsUI?.getSlideCount() || 8,
                ...(generationState.targetLanguage !== 'auto' ? { language: generationState.targetLanguage } : {})
            };
    
            const isFollowUpRequest = window.outlineEditorState && window.outlineEditorState.skeleton !== null;

            // Follow-up chat edits cost one simulated credit; initial outline/schema generation is free.
            if (isFollowUpRequest && !window.AedosCreditsUI?.canSpend(1)) {
                toggleGenerateLoading(false);
                return;
            }
            if (isFollowUpRequest) {
                const charge = window.AedosCredits.spend(1, 'chat');
                if (!charge.ok) {
                    window.AedosCreditsUI?.updateStatus('credits.missingOne', 'insufficient', { n: 1 });
                    toggleGenerateLoading(false);
                    return;
                }
            }
    
            if (isFollowUpRequest) {
                requestData.currentSkeleton = JSON.stringify(window.outlineEditorState.skeleton);
                // Backup the current skeleton in case the next instruction is a "proceed/create" action
                window._backupSkeleton = JSON.parse(JSON.stringify(window.outlineEditorState.skeleton));
            } else {
                window._backupSkeleton = null;
            }
    
            toggleGenerateLoading(true);
    
            let bodyData;
            // eslint-disable-next-line prefer-const -- Retain the existing request assembly unchanged.
            let headers = {};
            if (window._attachedFiles && window._attachedFiles.length > 0) {
                const formData = new FormData();
                formData.append('tema', requestData.tema);
                formData.append('modelId', requestData.modelId);
                if (requestData.mode) formData.append('mode', requestData.mode);
                if (requestData.language) formData.append('language', requestData.language);
                if (requestData.slides !== undefined) formData.append('slides', requestData.slides);
                if (requestData.currentSkeleton) formData.append('currentSkeleton', requestData.currentSkeleton);
                window._attachedFiles.forEach(f => formData.append('files', f));
                bodyData = formData;
            } else {
                headers['Content-Type'] = 'application/json';
                bodyData = JSON.stringify(requestData);
            }
    
            const controller = new AbortController();
            generationState.skeletonController = controller;
    
            if (window.showOutlineEditorLoading) {
                window.showOutlineEditorLoading(requestData.slides || 8);
            }
    
            // Before stream starts, prepare the outline streaming layout (fading pills, moving containers, etc.)
            if (window.prepareOutlineStreaming) {
                window.prepareOutlineStreaming(generationState.proModeEnabled ? 'pro' : 'flash');
            }
    
            // Only the very first request should mount the panel in the static
            // `#chat-ai-response` bubble. Follow-ups already create their own AI
            // bubble in `showOutlineEditorLoading()`, and re-targeting the static
            // bubble here makes the old top panel look like it is being reused.
            try {
                if (!isFollowUpRequest) {
                    const _initialAiBody = document.querySelector('#chat-ai-response .chat-ai-body');
                    if (_initialAiBody && window.AedosThinking) {
                        window.AedosThinking.show(_initialAiBody, {
                            label: window.__t ? window.__t('chat_stage_analyze', 'Analyzing your request…') : 'Analyzing your request…',
                            stage: 'stage1'
                        });
                    }
                }
            } catch (_) { /* panel is non-critical */ }
    
            try {
                const skeletonResponse = await fetch('/generate-skeleton', {
                    method: 'POST',
                    headers: headers,
                    body: bodyData,
                    signal: controller.signal
                });
    
                if (!skeletonResponse.ok) {
                    const errData = await skeletonResponse.json().catch(() => ({}));
                    const serverErr = errData.error || `Server error: ${skeletonResponse.status}`;
                    throw new Error(serverErr);
                }
    
                const skeletonStream = window.AedosHttpSse.openResponse(skeletonResponse, { framing: 'line' });
                let rawText = '';
                let finalSkeleton = null;
                let sawSkeletonSseParseError = false;
                const _skeletonReasoningAiBody = (() => {
                    const _aiMessages = document.querySelectorAll('.chat-msg-ai');
                    const _latestAi = _aiMessages[_aiMessages.length - 1];
                    return _latestAi && _latestAi.querySelector('.chat-ai-body');
                })();
    
                for await (const { data: dataStr } of skeletonStream.events) {
                    if (!dataStr) continue;
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.error) {
                            throw new Error(data.error);
                        }
    
                        // Reasoning tokens — surface in the thinking panel
                        // for the currently active AI bubble. The first
                        // request reuses the static #chat-ai-response;
                        // follow-ups work via showOutlineEditorLoading.
                        if (data.reasoning && typeof data.reasoning === 'string') {
                            const allAiBodies = document.querySelectorAll('.chat-msg-ai .chat-ai-body');
                            const _aiBody = allAiBodies[allAiBodies.length - 1];
                            if (_aiBody && window.AedosThinking) {
                                // Lazily create the panel if a previous
                                // legacy code path forgot to call show().
                                if (!window.AedosThinking.getPanel(_aiBody)) {
                                    window.AedosThinking.show(_aiBody, {
                                        label: window.__t ? window.__t('chat_stage_analyze', 'Analyzing your request…') : 'Analyzing your request…',
                                        stage: data.stage || 'stage1'
                                    });
                                }
                                window.AedosThinking.appendReasoning(_aiBody, data.reasoning);
                            }
                            continue;
                        }
    
                        if (data.chunk) {
                            rawText += data.chunk;
                            const partialSkeleton = window.parsePartialSkeleton(rawText);
                            if (window.outlineEditorState) {
                                window.outlineEditorState.skeleton = partialSkeleton;
                            }
                            if (window.renderStreamingOutline) {
                                window.renderStreamingOutline(partialSkeleton);
                            }
    
                            // Keep a compact live status while the outline itself streams.
                            if (partialSkeleton && partialSkeleton.slides && partialSkeleton.slides.length > 0) {
                                if (window.AedosThinking) {
                                    window.AedosThinking.collapseDetails(_skeletonReasoningAiBody);
                                    const outlineLabel = window.__t ? window.__t('chat_stage_outline', 'Building your outline…') : 'Building your outline…';
                                    window.AedosThinking.updateStatus(_skeletonReasoningAiBody, outlineLabel, 'outline');
                                }
                                // Legacy fall-back: also hide the old
                                // dot loader if it's still around.
                                const aiMessages = document.querySelectorAll('.chat-msg-ai');
                                const latestAiMessage = aiMessages[aiMessages.length - 1];
                                if (latestAiMessage) {
                                    const thinking = latestAiMessage.querySelector('.chat-thinking');
                                    if (thinking) thinking.classList.add('hidden');
                                }
                            }
                        }
                        if (data.done) {
                            finalSkeleton = data.skeleton;
                        }
                    } catch (e) {
                        sawSkeletonSseParseError = true;
                        console.error('SSE JSON error:', e);
                        if (e.message && (e.message.includes('Limit') || e.message.includes('pressure') || e.message.includes('failed') || e.message.includes('REJECTED'))) {
                            throw e;
                        }
                    }
                }
    
                // The skeleton fetch stream is complete. Free the skeleton controller safely.
                generationState.skeletonController = null;
    
                window._pendingGenerateBodyData = bodyData;
                window._pendingGenerateHeaders = headers;
    
                toggleGenerateLoading(false);
    
                if (!finalSkeleton) {
                    finalSkeleton = window.parsePartialSkeleton(rawText);
                }
    
                const hasRenderableSkeleton = !!(
                    finalSkeleton &&
                    Array.isArray(finalSkeleton.slides) &&
                    finalSkeleton.slides.length > 0
                );
    
                if (!hasRenderableSkeleton && (!finalSkeleton || !finalSkeleton.action)) {
                    const streamWasInterrupted = sawSkeletonSseParseError || rawText.trim().length > 0 || !finalSkeleton;
                    if (streamWasInterrupted) {
                        throw new Error(
                            window.__t
                                ? window.__t('outline_stream_interrupted', 'The outline response was interrupted. Please try again.')
                                : 'The outline response was interrupted. Please try again.'
                        );
                    }
                }
    
                // Only hide the panel when nothing useful arrived. If the model
                // streamed reasoning successfully, keep it collapsed so the chat
                // does not look empty after a recoverable failure.
                if (window.AedosThinking) {
                    if (!hasRenderableSkeleton) {
                        if (!finalSkeleton || !finalSkeleton.action) {
                            if (window.AedosThinking.hasReasoning && window.AedosThinking.hasReasoning(_skeletonReasoningAiBody)) {
                                window.AedosThinking.collapse(_skeletonReasoningAiBody);
                            } else {
                                window.AedosThinking.hide(_skeletonReasoningAiBody);
                            }
                        }
                    } else if (finalSkeleton.action === 'proceed') {
                        // Proceed flow: collapse (not hide) the panel and let
                        // the "Drafting slides…" message take over visually.
                        window.AedosThinking.collapse(_skeletonReasoningAiBody);
                    } else {
                        const readyLabel = window.__t ? window.__t('outline_ready', 'Outline ready') : 'Outline ready';
                        window.AedosThinking.collapse(_skeletonReasoningAiBody, readyLabel);
                    }
                }
    
                if (finalSkeleton && finalSkeleton.action === 'proceed') {
                    handleProceedFlow(finalSkeleton);
                    return;
                }
    
                if (window.finalizeStreamingOutline) {
                    window.finalizeStreamingOutline(finalSkeleton);
                } else {
                    throw new Error("Outline editor not initialized");
                }
            } catch (error) {
                if (isFollowUpRequest) {
                    window.AedosCredits.refund(1, 'failed-chat');
                    window.AedosCreditsUI?.refresh();
                }
                handleSkeletonError(error, controller);
            }
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createSkeletonGeneration = createSkeletonGeneration;
})(window);
