/* eslint-disable max-lines-per-function, complexity */

const express = require('express');
const { processGeneratedOutput } = require('./generate-output');
const { handleGenerationError } = require('./generate-errors');
const vendorAssets = require('../../../frontend/features/shared/vendor-assets');
const { resolveModelId, validateModelForGeneration, validateAttachments } = require('../../config/model-catalog');
const {
    normalizeMode,
    normalizeRequestedLanguage,
    normalizeValidatedLanguage,
    normalizeSlides,
    normalizeSkeletonValue,
    normalizeTopic
} = require('../../contracts/request-normalizers');

/**
 * Create the main generation endpoint handler.
 *
 * @param {any} deps generation dependencies
 * @returns {Function}
 */
function createGenerateHandler(deps) {
    const trySelectedFlash = deps.trySelectedFlash || deps.tryModelsFlash;
    const trySelectedStage3Thinking = deps.trySelectedStage3Thinking || deps.tryModelsStage3Thinking;
    return async function(req, res) {
        let cancelled = false;
        let completed = false;
        let creditDelivered = false;
        let sseKeepAlive = null;
        let hasGenerationSlot = false;
        const requestId = req.requestId || 'n/a';

        res.on('close', () => {
            if (res.writableEnded || completed) return;
            deps.log.warn(deps.ErrorCategory.STREAM, 'Client disconnected before generation completed', { requestId });
            cancelled = true;
        });
        res.on('error', (err) => {
            deps.log.warn(deps.ErrorCategory.STREAM, 'Generation response stream error, marking request cancelled', {
                requestId,
                error: String((err && err.message) || err)
            });
            cancelled = true;
        });

        try {
            const opciones = req.body || {};
            const modelSelection = resolveModelId(opciones.modelId);
            if (!modelSelection.valid) {
                await deps.discardUploadedFiles?.(req.files);
                return res.status(422).json({ error: modelSelection.message, code: modelSelection.code });
            }
            const requestedLanguage = normalizeRequestedLanguage(req.body);
            if (typeof opciones.skeleton === 'string') {
                const originalSkeleton = opciones.skeleton;
                opciones.skeleton = normalizeSkeletonValue(originalSkeleton);
                if (opciones.skeleton === originalSkeleton && originalSkeleton) {
                    deps.log.warn(deps.ErrorCategory.VALIDATION, 'Failed to parse skeleton from FormData', { requestId });
                }
            }

            if (opciones.skeleton && typeof opciones.skeleton === 'object') {
                if (opciones.skeleton.action === 'proceed') {
                    return res.status(400).json({ error: deps.ERROR_TEXT.SKELETON_EMPTY });
                }
                const skeletonSlides = opciones.skeleton.slides;
                if (!Array.isArray(skeletonSlides) || skeletonSlides.length === 0) {
                    return res.status(400).json({ error: deps.ERROR_TEXT.SKELETON_EMPTY });
                }
            }

            deps.log.info(deps.ErrorCategory.PIPELINE, 'Generation request accepted', {
                requestId,
                mode: normalizeMode(req.body),
                idioma: requestedLanguage,
                requestedSlides: req.body.slides
            });

            const topicResult = normalizeTopic(opciones.tema, deps.sanitizeTema);
            if (!topicResult.valid) {
                deps.log.warn(deps.ErrorCategory.VALIDATION, 'Topic rejected by sanitizer', { requestId, reason: topicResult.reason });
                return res.status(400).json(deps.invalidTopic(topicResult.reason));
            }

            const targetLang = requestedLanguage;
            opciones.targetLanguage = targetLang;
            opciones.tema = topicResult.tema;
            const usePipeline = normalizeMode(req.body) === 'pro';

            const slidesResult = normalizeSlides(req.body);
            if (!slidesResult.valid) {
                deps.log.warn(deps.ErrorCategory.VALIDATION, 'Slides validation failed', { requestId, slides: req.body.slides });
                return res.status(422).json(deps.validationFailed({ slides: 'must be integer between 1 and 15' }));
            }

            const slideHardLimit = usePipeline ? deps.MAX_PRO_SLIDES : deps.MAX_FLASH_SLIDES;
            let slidesNum = slidesResult.requestedSlides;
            if (slidesResult.capped) {
                deps.log.warn(deps.ErrorCategory.VALIDATION, 'Slides capped to mode hard limit', {
                    requestId,
                    requestedSlides: slidesNum,
                    appliedLimit: slideHardLimit
                });
                slidesNum = slidesResult.slides;
                opciones.slides = slidesNum;
            }
            const modelCompatibility = validateModelForGeneration(modelSelection.model, normalizeMode(req.body), slidesNum);
            if (!modelCompatibility.valid) {
                await deps.discardUploadedFiles?.(req.files);
                return res.status(422).json({ error: modelCompatibility.message, code: modelCompatibility.code,
                    maxSlides: modelCompatibility.maxSlides });
            }

            const hasAttachments = Array.isArray(req.files) && req.files.length > 0;
            if (hasAttachments) {
                const geminiAvailable = await deps.hasGeminiRequestAvailable?.() === true;
                const attachmentValidation = validateAttachments(modelSelection.model, true, geminiAvailable);
                if (!attachmentValidation.valid) {
                    await deps.discardUploadedFiles?.(req.files);
                    return res.status(422).json({ error: attachmentValidation.message, code: attachmentValidation.code });
                }
            }

            const languageResult = normalizeValidatedLanguage(req.body);
            if (!languageResult.valid) {
                deps.log.warn(deps.ErrorCategory.VALIDATION, 'Language validation failed', { requestId, idioma: req.body.idioma || 'es' });
                return res.status(422).json(deps.validationFailed(languageResult.fields));
            }

            const hasProviderCredentials = deps.hasProviderCredentials
                ? deps.hasProviderCredentials()
                : Boolean(process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY);
            if (!hasProviderCredentials) {
                deps.log.error(deps.ErrorCategory.CONFIG, 'Generation blocked: OpenRouter/Gemini key missing', { requestId });
                return res.status(500).json({ error: deps.ERROR_TEXT.API_KEY_MISSING });
            }

            deps.setSseHeaders(res);
            sseKeepAlive = setInterval(() => {
                if (!completed && !cancelled && !res.writableEnded && !res.destroyed) {
                    try {
                        res.write(`data: ${JSON.stringify({ heartbeat: true })}\n\n`);
                    } catch (_) { /* socket already gone, loop will unwind via cancelled */ }
                }
            }, 25000);

            const queueResult = await deps.generationQueue.enqueue(req, { requestId, usePipeline, res });
            if (queueResult === 'rejected' || queueResult === 'disconnected') {
                completed = true;
                return;
            }
            hasGenerationSlot = true;

            const fileContext = await deps.buildGenerationFileContext(req.files, { requestId, log: deps.log, ErrorCategory: deps.ErrorCategory });
            let fullHtml = '';
            let hasStartedValidContent = false;
            let selectedRoute = null;
            let pipelineResult = null;

            if (!usePipeline) {
                const flashOut = await deps.runFlashGenerationWithRetry({
                    cancelledRef: () => cancelled,
                    res,
                    requestId,
                    opciones,
                    fileContext,
                    slideHardLimit,
                    tryModelsFlash: (prompt, flashFileContext) => trySelectedFlash(prompt, flashFileContext, {
                        selectedModel: modelSelection.model,
                        attachmentsRequireGemini: hasAttachments,
                        modelRoute: { requestedModelId: modelSelection.requestedModelId,
                            effectiveModelId: modelSelection.requestedModelId, fallbackReason: null }
                    }),
                    buildPrompt: deps.buildPrompt,
                    log: deps.log,
                    ErrorCategory: deps.ErrorCategory,
                    consumeStream: (streamResult, response, id, cancelledRef, hardLimit) => deps.consumeModelStream(
                        { log: deps.log, ErrorCategory: deps.ErrorCategory }, streamResult, response, id, cancelledRef, hardLimit
                    )
                });
                fullHtml = flashOut.fullHtml;
                hasStartedValidContent = flashOut.hasStartedValidContent;
                selectedRoute = flashOut.result?.modelRoute || null;
            } else {
                deps.log.info(deps.ErrorCategory.PIPELINE, 'Running pro pipeline path', { requestId });
                res.write(`data: ${JSON.stringify({ pipeline: true, stage: 'content', status: 'running' })}\n\n`);
                pipelineResult = await deps.runPipeline({
                    rawInput: opciones.tema,
                    targetLanguage: targetLang,
                    fileContext,
                    skeleton: opciones.skeleton,
                    maxSlides: slideHardLimit,
                    tryModelsStage1: (prompt, stageFiles, options) => deps.tryModelsStage1Thinking(prompt, stageFiles, {
                        ...options,
                        attachmentsRequireGemini: Array.isArray(stageFiles) && stageFiles.length > 0,
                        modelRoute: { requestedModelId: modelSelection.requestedModelId,
                            effectiveModelId: null, fallbackReason: null }
                    }),
                    tryModelsStage2: (prompt, stageFiles, options) => deps.tryModelsStage2Thinking(prompt, stageFiles, {
                        ...options,
                        modelRoute: { requestedModelId: modelSelection.requestedModelId,
                            effectiveModelId: null, fallbackReason: null }
                    }),
                    tryModelsStage3: (prompt, stageFiles, options) => trySelectedStage3Thinking(prompt, stageFiles, {
                        ...options,
                        selectedModel: modelSelection.model,
                        modelRoute: { requestedModelId: modelSelection.requestedModelId,
                            effectiveModelId: modelSelection.requestedModelId, fallbackReason: null }
                    }),
                    onStageUpdate: (stage, data) => {
                        if (!cancelled && !res.writableEnded && !res.destroyed) {
                            const stageNames = { stage1: 'content', stage2: 'design', stage3: 'compositing' };
                            try {
                                res.write(`data: ${JSON.stringify({ pipeline: true, stage: stageNames[stage] || stage, ...data })}\n\n`);
                            } catch (_) { /* socket gone */ }
                        }
                    },
                    onChunk: (item) => {
                        if (!cancelled && !res.writableEnded && !res.destroyed && item && item.type === 'reasoning' && item.stage !== 'stage3') {
                            try {
                                res.write(`data: ${JSON.stringify({ reasoning: item.text, stage: item.stage })}\n\n`);
                            } catch (_) { /* ignore broken pipe */ }
                        }
                    }
                });

                if ((process.env.NODE_ENV || 'development') !== 'production') {
                    try {
                        const now = Date.now();
                        const debugBase = deps.path.join(deps.TMP_DIR, `pipeline_debug_${now}`);
                        deps.fs.writeFileSync(debugBase + '_content.json', JSON.stringify(pipelineResult.contentJson, null, 2), 'utf8');
                        deps.fs.writeFileSync(debugBase + '_design.json', JSON.stringify(pipelineResult.designJson, null, 2), 'utf8');
                        if (pipelineResult.stage3Prompt) deps.fs.writeFileSync(debugBase + '_stage3prompt.txt', pipelineResult.stage3Prompt, 'utf8');
                        deps.devLog.success(deps.ErrorCategory.FILESYSTEM, 'Saved pipeline debug artifacts', { requestId, pathPrefix: `${debugBase}_*` });
                    } catch (e) {
                        deps.devLog.warn(deps.classifyError(e, deps.ErrorCategory.FILESYSTEM), 'Failed to save pipeline debug artifacts', { requestId, error: e });
                    }
                }

                if (cancelled) { res.end(); return; }
                deps.log.info(deps.ErrorCategory.PIPELINE, 'Stage 3 stream ready, starting SSE forwarding', { requestId });
                const proStream = await deps.consumeModelStream(
                    { log: deps.log, ErrorCategory: deps.ErrorCategory },
                    pipelineResult.stage3Stream,
                    res, requestId, () => cancelled, slideHardLimit
                );
                fullHtml = proStream.fullHtml;
                hasStartedValidContent = proStream.hasStartedValidContent;
            }

            void hasStartedValidContent;
            if (cancelled) {
                res.end();
                return;
            }

            const output = processGeneratedOutput({
                fullHtml,
                usePipeline,
                requestId,
                opciones,
                res,
                maxProSlides: deps.MAX_PRO_SLIDES,
                maxFlashSlides: deps.MAX_FLASH_SLIDES,
                sanitizeGeneratedHtml: deps.sanitizeGeneratedHtml,
                injectLayoutSafetyNet: deps.injectLayoutSafetyNet,
                sanitizerLog: deps.sanitizerLog,
                ErrorCategory: deps.ErrorCategory,
                isDevelopment: deps.IS_DEVELOPMENT,
                tmpDir: deps.TMP_DIR,
                fs: deps.fs,
                path: deps.path,
                devLog: deps.devLog,
                classifyError: deps.classifyError,
                extractPresentationTitle: deps.extractPresentationTitle,
                buildFileStemFromTitle: deps.buildFileStemFromTitle,
                resolveUniqueHtmlPath: deps.resolveUniqueHtmlPath,
                examplesFlashDir: deps.EXAMPLES_FLASH_DIR,
                examplesProDir: deps.EXAMPLES_PRO_DIR,
                vendorAssets
            });
            if (output.type === 'refused') {
                res.write(`data: ${JSON.stringify({ refused: true, message: output.message })}\n\n`);
            } else if (output.type === 'ended') {
                return;
            } else {
                const modelRoute = usePipeline ? pipelineResult?.stage3Stream?.modelRoute : selectedRoute;
                const effectiveModelRoute = modelRoute || {
                    requestedModelId: modelSelection.requestedModelId,
                    effectiveModelId: modelSelection.requestedModelId,
                    fallbackReason: null
                };
                if (req.creditReservation && !(await deps.creditsLedger.commit(req.creditReservation))) {
                    throw new Error('CREDITS_UNAVAILABLE');
                }
                res.write(`data: ${JSON.stringify({ done: true, html: output.html,
                    requestedModelId: effectiveModelRoute.requestedModelId,
                    effectiveModelId: effectiveModelRoute.effectiveModelId,
                    fallbackReason: effectiveModelRoute.fallbackReason })}\n\n`);
            }

            completed = true;
            res.end();
            creditDelivered = output.type === 'html';
        } catch (error) {
            handleGenerationError({
                error,
                requestId,
                res,
                log: deps.log,
                classifyError: deps.classifyError,
                ErrorCategory: deps.ErrorCategory,
                markCompleted: () => { completed = true; }
            });
        } finally {
            if (req.creditReservation && !creditDelivered) {
                try { await deps.creditsLedger.refund(req.creditReservation); }
                catch (_) { deps.log.error(deps.ErrorCategory.NETWORK, 'Failed to refund generation credit reservation', { requestId }); }
            }
            if (sseKeepAlive) clearInterval(sseKeepAlive);
            if (hasGenerationSlot) deps.generationQueue.release();
        }
    };
}

/**
 * Register the main generation endpoint with its original middleware order.
 *
 * @param {any} deps generation route dependencies
 * @returns {void}
 */
function registerGenerateRoute(deps) {
    const handler = createGenerateHandler(deps);
    deps.app.post('/generate', deps.upload.array('files', deps.maxUploadArrayFields), express.json({ limit: '50kb' }), deps.checkGenerationPressure, deps.validateModelRequest, deps.checkRateLimits, deps.reserveGenerationCredits, async (req, res) => handler(req, res));
}

module.exports = { createGenerateHandler, registerGenerateRoute };
