(function registerFinalGeneration(global) {
    'use strict';

    /** @typedef {{ getDeps: Function }} FinalGenerationDependencies */
    /** Keep the complete final SSE lifecycle behind the existing window facade. @param {FinalGenerationDependencies} deps */
    // eslint-disable-next-line max-lines-per-function -- The factory only defers live dependency access.
    function createFinalGeneration({ getDeps }) {
        // eslint-disable-next-line max-lines-per-function, complexity -- Preserve the original final-generation lifecycle.
        return async function startFinalGeneration(skeleton) {
            const { window, document, generationState, previewState, previewUiState,
                previewContainer, previewHeader, chatScreen, refusedMessage,
                refusedContainer, errorMessage, showErrorModal, uiLog, generateBtn,
                pauseBtnMessages, resumeBtnMessages, toggleGenerateLoading,
                appendReasoningProgress, showStageProgress, setPreviewStreamStatus,
                FormData, AbortController, fetch, clearTimeout, setTimeout,
                initPreview, scaleIframe, clearInterval, clearPendingTransition,
                setStabilizeMinimapOnNextPreviewInit, slideDots, slideLabel,
                stopBtnMessages, resetMobileZoomState, updateZoomDisplay,
                clearStageInlinePadding, updateMinimapSkeleton, requestAnimationFrame } = getDeps();
            const { generation, iframeDoc, previewMarkupBuffer, G_FONTS, loadingHtml, tema, previewLabel, hasTransitioned } =
                window.AedosGeneration.createFinalGenerationSetup({
                    window, document, generationState, previewState, previewUiState,
                    previewContainer, previewHeader, chatScreen, slideDots, slideLabel,
                    clearPendingTransition: () => { clearPendingTransition(); },
                    scaleIframe, stopBtnMessages, resetMobileZoomState, updateZoomDisplay,
                    clearStageInlinePadding, setPreviewStreamStatus, updateMinimapSkeleton,
                    requestAnimationFrame, setTimeout, clearTimeout,
                });
            let chargedCredits = 0;
            let generationCompleted = false;
    
            try {
                if (generationState.activeController) {
                    console.warn("A generation is already in progress. Ignoring duplicate request.");
                    return;
                }
                
                const controller = new AbortController();
                generationState.activeController = controller;

                const requestedSlides = Math.min(window.AedosCreditsUI.getSlideCount(), Math.max(1, Array.isArray(skeleton?.slides) ? skeleton.slides.length : 8));
                const requestedCreditCost = window.AedosCreditsUI.getQuote(requestedSlides).total;
                if (!window.AedosCreditsUI?.canSpend(requestedCreditCost)) return;
                const creditCharge = window.AedosCredits.spend(requestedCreditCost, 'presentation');
                if (!creditCharge.ok) {
                    window.AedosCreditsUI?.updateStatus('credits.insufficient', 'insufficient', { cost: requestedCreditCost, left: creditCharge.balance });
                    chargedCredits = 0;
                    return;
                }
                chargedCredits = requestedCreditCost;
                window.AedosCreditsUI?.refresh();
    
                let bodyData = window._pendingGenerateBodyData;
                // eslint-disable-next-line prefer-const -- Retain the existing request assembly unchanged.
                let headers = window._pendingGenerateHeaders || {};
    
                // Bug #3: Clone body data so we don't mutate the original FormData/JSON
                // (multiple retries would otherwise accumulate extra 'skeleton' fields)
                if (bodyData instanceof FormData) {
                    const cloned = new FormData();
                    for (const [key, val] of bodyData.entries()) {
                        if (key !== 'files' && key !== 'mode' && key !== 'modelId' && key !== 'slides') {
                            cloned.append(key, val);
                        }
                    }
                    // Restore actual generation mode (skeleton was tagged 'chat' for rate limiting)
                    if (generationState.proModeEnabled) cloned.append('mode', 'pro');
                    // The server must validate modelId and compute the authoritative cost; client fields are untrusted.
                    cloned.append('modelId', generationState.selectedModelId || 'google/gemini-3-flash-preview');
                    cloned.append('slides', String(requestedSlides));
                    cloned.append('skeleton', JSON.stringify(skeleton));
                    bodyData = cloned;
                } else {
                    const parsed = JSON.parse(bodyData);
                    parsed.skeleton = skeleton;
                    // The server must validate modelId and compute the authoritative cost; client fields are untrusted.
                    parsed.modelId = generationState.selectedModelId || parsed.modelId || 'google/gemini-3-flash-preview';
                    parsed.slides = requestedSlides;
                    // Restore actual generation mode (skeleton was tagged 'chat' for rate limiting)
                    if (generationState.proModeEnabled) {
                        parsed.mode = 'pro';
                    } else {
                        delete parsed.mode;
                    }
                    bodyData = JSON.stringify(parsed);
                }
    
                const response = await fetch('/generate', {
                    method: 'POST',
                    headers: headers,
                    body: bodyData,
                    signal: controller.signal
                });
    
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const serverErr = errorData.error || `Server error: ${response.status}`;
                    const retryAfter = Number(errorData.retryAfterSec);
                    if (Number.isFinite(retryAfter) && retryAfter > 0) {
                        throw new Error(`${serverErr}|RETRY_AFTER=${retryAfter}`);
                    }
                    throw new Error(serverErr);
                }
    
                const reader = response.body.getReader();
                let firstWrite = true;
                const _generateReasoningAiBody = (() => {
                    const _aiMessages = document.querySelectorAll('.chat-msg-ai');
                    const _latestAi = _aiMessages[_aiMessages.length - 1];
                    return _latestAi && _latestAi.querySelector('.chat-ai-body');
                })();
                const writeInitialStreamMarkup = window.AedosPreview.createInitialStreamMarkup({
                    window,
                    iframeDoc,
                    generationState,
                    setPreviewStreamStatus,
                    reasoningBody: _generateReasoningAiBody,
                    fontLinks: G_FONTS,
                    loadingHtml,
                });
                // Safety timeout: if no SSE data arrives within a period, abort to prevent
                // an infinite hang when the server closes without sending {done:true}.
                // Pro mode (3-stage pipeline) can take longer, so use a longer timeout that also
                // resets when we receive pipeline stage updates (not just HTML chunks).
                const SSE_WATCHDOG_MS = 600000; // 10 minutes total, enough for all 3 Pro stages
                let sseWatchdog;
                const resetWatchdog = () => {
                    clearTimeout(sseWatchdog);
                    sseWatchdog = setTimeout(() => {
                        uiLog.warn('STREAM', 'SSE watchdog fired without activity, cancelling reader', {
                            timeoutMs: SSE_WATCHDOG_MS
                        });
                        reader.cancel();
                    }, SSE_WATCHDOG_MS);
                };
                resetWatchdog();
    
                const generationEvents = window.AedosHttpSse.readReader(reader, {
                    framing: 'event',
                    flushTail: true,
                    onChunk: resetWatchdog
                });
                for await (const { data: dataStr, tail } of generationEvents) {
                    if (tail) {
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.chunk) previewMarkupBuffer.queue(window.AedosContentUtils.sanitizeModelOutput(parsed.chunk));
                            if (parsed.done && parsed.html) previewState.generatedHtml = parsed.html;
                        // eslint-disable-next-line no-empty -- Preserve the original optional SSE-tail parse guard.
                        } catch (e) { }
                        continue;
                    }
                    if (dataStr.trim() === '[DONE]') continue;
                    let parsed;
                    try { parsed = JSON.parse(dataStr); } catch (e) { continue; }
    
                            if (parsed.queued === true) {
                                pauseBtnMessages();
                                const label = generateBtn.querySelector('.btn-generate-label');
                                if (label) {
                                    const msg = window.__t("queued_position", "Waiting in queue — position {pos}");
                                    label.textContent = msg.replace('{pos}', parsed.position);
                                }
                                continue;
                            }
                            if (parsed.queued === false) {
                                resumeBtnMessages();
                                continue;
                            }
    
                            // Reasoning tokens stream — surface them in the new
                            // thinking panel. We use the latest AI bubble as the
                            // host (the same one that shows the "Drafting
                            // slides…" status text). For Pro mode, the server
                            // tags reasoning with a `stage` field so we can
                            // update the panel's accent color and label.
                            if (parsed.reasoning && typeof parsed.reasoning === 'string') {
                                appendReasoningProgress(parsed);
                                continue;
                            }
    
                            // Pipeline stage progress events
                            if (parsed.pipeline) {
                                showStageProgress(parsed);
                                continue;
                            }
    
                                if (parsed.chunk) {
                                    if (firstWrite) {
                                        firstWrite = false;
                                        writeInitialStreamMarkup();
                                    }
                                    previewMarkupBuffer.queue(window.AedosContentUtils.sanitizeModelOutput(parsed.chunk));
                            }
                            if (parsed.refused) {
                                window.AedosCredits.refund(chargedCredits, 'refused-presentation');
                                chargedCredits = 0;
                                window.AedosCreditsUI?.refresh();
                                clearPendingTransition();
                                setStabilizeMinimapOnNextPreviewInit(false);
                                chatScreen.style.cssText = '';
                                chatScreen.classList.remove('hidden');
                                refusedMessage.textContent = parsed.message || (window.__t ? window.__t('refused_msg', "This topic cannot be generated.") : "This topic cannot be generated.");
                                refusedContainer.classList.remove('hidden');
                                previewContainer.classList.remove('is-generating', 'is-awaiting-first-slide');
                                previewContainer.classList.add('hidden');
                                iframeDoc.close();
                                toggleGenerateLoading(false);
                                // Reset title/subtitle to defaults for next generation error
                                const eTitleEl = document.getElementById('t-error-title');
                                if (eTitleEl) eTitleEl.setAttribute('data-i18n', 'error_title');
                                return;
                            }
                            if (parsed.error) {
                                throw new Error(parsed.error);
                            }
                            if (parsed.metadata) {
                                uiLog.info('GENERATION', 'Model Selected', { provider: parsed.metadata.provider, model: parsed.metadata.model });
                                continue;
                            }
                            if (parsed.done) {
                                previewState.generatedHtml = parsed.html;
                                let displayTitle = tema;
                                const configMatch = previewState.generatedHtml.match(/<!--\s*CONFIG\s*([\s\S]*?)\s*-->/i);
                                if (configMatch) {
                                    try {
                                        const configObj = JSON.parse(configMatch[1]);
                                        if (configObj.Clean_Topic) displayTitle = configObj.Clean_Topic;
                                    // eslint-disable-next-line no-empty -- Preserve the original optional title-config guard.
                                    } catch (e) { }
                                }
                                if (displayTitle === tema) {
                                    const titleMatch = previewState.generatedHtml.match(/<title>\s*(.*?)\s*<\/title>/i);
                                    if (titleMatch && titleMatch[1]) {
                                        displayTitle = titleMatch[1];
                                    } else {
                                        const h1Match = previewState.generatedHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                                        if (h1Match && h1Match[1]) {
                                            displayTitle = h1Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                                        }
                                    }
                                }
                                if (previewLabel) {
                                    if (previewLabel.tagName === 'INPUT') previewLabel.value = displayTitle;
                                    else previewLabel.textContent = displayTitle;
                                }
                                previewState.currentTitle = displayTitle;
                            }
                }
    
                clearTimeout(sseWatchdog);
    
                if (!previewState.generatedHtml || previewState.generatedHtml.trim().length < 50) {
                    throw new Error(window.__t ? window.__t('error_generation_failed', "Sorry, could not generate the presentation correctly.") : "Sorry, could not generate the presentation correctly.");
                }
    
                previewMarkupBuffer.finish();
    
                await window.AedosPreview.createFinalPreviewReveal({
                    window, document, iframeDoc, generationState, generation,
                    previewState, previewUiState, previewContainer, previewHeader,
                    initPreview, scaleIframe,
                    clearPendingTransition: () => { clearPendingTransition(); },
                    setTimeout
                })();
                generationCompleted = true;
                window.AedosCreditsUI?.refresh();
    
            } catch (error) {
                if (chargedCredits > 0 && !generationCompleted) {
                    window.AedosCredits.refund(chargedCredits, error.name === 'AbortError' ? 'cancelled-presentation' : 'failed-presentation');
                    chargedCredits = 0;
                    window.AedosCreditsUI?.refresh();
                }
                previewMarkupBuffer.clearTimer();
                previewMarkupBuffer.markClosed();
                if (generationState.activeGeneration === generation) {
                    generationState.activeGeneration = null;
                    clearPendingTransition();
                }
                if (generationState.activeController && generationState.activeController.signal.aborted) {
                    return;
                }
                setStabilizeMinimapOnNextPreviewInit(false);
    
                // Ignore intentional user cancellations (Back button)
                if (error.name === 'AbortError') {
                    // Bug #17: clean up generating state even on abort
                    const btnOutlineGenerate = document.getElementById('btn-outline-generate');
                    if (btnOutlineGenerate) btnOutlineGenerate.classList.remove('is-generating');
                    iframeDoc.close();
                    return;
                }
    
                window.AedosGeneration.createErrorPresenter({
                    window,
                    document,
                    uiLog,
                    errorMessage,
                    previewContainer,
                    chatScreen,
                    showErrorModal,
                    clearInterval,
                })(error, iframeDoc, hasTransitioned());
            } finally {
                generationState.activeController = null;
                toggleGenerateLoading(false);
                // Re-enable minimap skeleton updates for subsequent normal generations.
                previewUiState.skipMinimapSkeleton = false;
                // is-generating is cleared by the reveal callback (success) or catch block (error).
                // Do NOT remove it here — that would cause panels to flash before the reveal animation.
                clearPendingTransition();
            }
        };
    }

    global.AedosGeneration = global.AedosGeneration || {};
    global.AedosGeneration.createFinalGeneration = createFinalGeneration;
})(window);
