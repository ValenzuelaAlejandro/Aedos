/* eslint-disable max-lines-per-function, complexity */

const express = require('express');
const { processGeneratedOutput } = require('./generate-output');
const { handleGenerationError } = require('./generate-errors');
const vendorAssets = require('../../../frontend/features/shared/vendor-assets');
const { resolveModelId, validateModelForGeneration, validateAttachments } = require('../../config/model-catalog');
const { quoteModel } = require('../middleware/generation-credits');
const { countCompleteSlides, extractCompleteSlides, appendSlides, buildMissingSlidesPrompt } = require('../../pipeline/slide-output');
const {
    normalizeMode,
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
            const languageResult = normalizeValidatedLanguage(req.body);
            if (!languageResult.valid) {
                deps.log.warn(deps.ErrorCategory.VALIDATION, 'Language validation failed', { requestId, idioma: req.body.language || req.body.idioma || 'auto' });
                return res.status(422).json(deps.validationFailed(languageResult.fields));
            }
            const requestedLanguage = languageResult.idioma;
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
                return res.status(422).json(deps.validationFailed(slidesResult.fields));
            }

            const slideHardLimit = usePipeline ? deps.MAX_PRO_SLIDES : deps.MAX_FLASH_SLIDES;
            const slidesNum = slidesResult.slides;
            opciones.slides = slidesNum;
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
            const consume = (streamResult, response, id, cancelledRef, hardLimit, options) => deps.consumeModelStream(
                { log: deps.log, ErrorCategory: deps.ErrorCategory }, streamResult, response, id, cancelledRef, hardLimit, options
            );

            if (!usePipeline) {
                const flashOut = await deps.runFlashGenerationWithRetry({
                    cancelledRef: () => cancelled,
                    res,
                    requestId,
                    opciones,
                    fileContext,
                    slideHardLimit: slidesNum,
                    tryModelsFlash: (prompt, flashFileContext) => trySelectedFlash(prompt, flashFileContext, {
                        selectedModel: modelSelection.model,
                        expectedMaxSlides: slidesNum,
                        attachmentsRequireGemini: hasAttachments,
                        modelRoute: { requestedModelId: modelSelection.requestedModelId,
                            effectiveModelId: modelSelection.requestedModelId, fallbackReason: null }
                    }),
                    buildPrompt: deps.buildPrompt,
                    log: deps.log,
                    ErrorCategory: deps.ErrorCategory,
                    consumeStream: (streamResult, response, id, cancelledRef, hardLimit) => consume(
                        streamResult, response, id, cancelledRef, hardLimit
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
                    requestedSlides: slidesNum,
                    tryModelsStage1: (prompt, stageFiles, options) => (deps.trySelectedStage1Thinking || deps.tryModelsStage1Thinking)(prompt, stageFiles, {
                        ...options,
                        expectedOutput: 'outline',
                        selectedModel: modelSelection.model,
                        attachmentsRequireGemini: Array.isArray(stageFiles) && stageFiles.length > 0,
                        modelRoute: { requestedModelId: modelSelection.requestedModelId,
                            effectiveModelId: null, fallbackReason: null }
                    }),
                    tryModelsStage2: (prompt, stageFiles, options) => (deps.trySelectedStage2Thinking || deps.tryModelsStage2Thinking)(prompt, stageFiles, {
                        ...options,
                        selectedModel: modelSelection.model,
                        modelRoute: { requestedModelId: modelSelection.requestedModelId,
                            effectiveModelId: null, fallbackReason: null }
                    }),
                    tryModelsStage3: (prompt, stageFiles, options) => trySelectedStage3Thinking(prompt, stageFiles, {
                        ...options,
                        expectedMaxSlides: slidesNum,
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
                        if (item?.type === 'resumed' && !cancelled && !res.writableEnded && !res.destroyed) {
                            res.write(`data: ${JSON.stringify({ resumed: true, stage: item.stage })}\n\n`);
                            return;
                        }
                        if (item?.type === 'reset' && !cancelled && !res.writableEnded && !res.destroyed) {
                            res.write(`data: ${JSON.stringify({ reset: true, stage: item.stage, attempt: item.attempt })}\n\n`);
                            return;
                        }
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
                    res, requestId, () => cancelled, slidesNum
                );
                fullHtml = proStream.fullHtml;
                hasStartedValidContent = proStream.hasStartedValidContent;
            }

            void hasStartedValidContent;
            if (cancelled) {
                res.end();
                return;
            }

            // Complete only missing trailing slides with the originally selected model.
            // Each repair batch is isolated; provider resets replay only accepted HTML.
            let deliveredSlides = countCompleteSlides(fullHtml);
            if (deliveredSlides > slidesNum) throw new Error('SLIDE_COUNT_EXCEEDED');
            let repairRoute = null;
            for (let repairRound = 0; deliveredSlides > 0 && deliveredSlides < slidesNum && repairRound < 5; repairRound += 1) {
                const batchSize = Math.min(3, slidesNum - deliveredSlides);
                const repairPrompt = buildMissingSlidesPrompt({
                    topic: opciones.tema,
                    language: targetLang,
                    requestedSlides: slidesNum,
                    firstMissingIndex: deliveredSlides + 1,
                    count: batchSize,
                    outline: pipelineResult?.contentJson?.slides || opciones.skeleton?.slides,
                    acceptedHtml: fullHtml
                });
                try {
                    const callRepairModel = usePipeline
                        ? () => trySelectedStage3Thinking(repairPrompt, null, {
                            selectedModel: modelSelection.model,
                            expectedMaxSlides: batchSize,
                            modelRoute: { requestedModelId: modelSelection.requestedModelId,
                                effectiveModelId: modelSelection.requestedModelId, fallbackReason: null }
                        })
                        : () => trySelectedFlash(repairPrompt, fileContext, {
                            selectedModel: modelSelection.model,
                            expectedMaxSlides: batchSize,
                            modelRoute: { requestedModelId: modelSelection.requestedModelId,
                                effectiveModelId: modelSelection.requestedModelId, fallbackReason: null }
                        });
                    const repairResult = await callRepairModel();
                    repairRoute = repairResult?.modelRoute || repairRoute;
                    const repaired = await consume(repairResult, res, requestId, () => cancelled, batchSize,
                        { baselineHtml: fullHtml });
                    const repairSlides = extractCompleteSlides(repaired.repairHtml || repaired.fullHtml);
                    if (!repairSlides.length) {
                        res.write(`data: ${JSON.stringify({ reset: true, stage: 'content' })}\n\n`);
                        res.write(`data: ${JSON.stringify({ chunk: fullHtml, replay: true })}\n\n`);
                        break;
                    }
                    fullHtml = appendSlides(fullHtml, repairSlides.slice(0, batchSize));
                    deliveredSlides = countCompleteSlides(fullHtml);
                } catch (repairError) {
                    deps.log.warn(deps.ErrorCategory.PIPELINE, 'Missing slide repair exhausted for selected model', {
                        requestId, selectedModelId: modelSelection.requestedModelId,
                        requestedSlides: slidesNum, deliveredSlides, repairRound: repairRound + 1,
                        reason: repairError.message
                    });
                    if (!cancelled && !res.writableEnded && !res.destroyed) {
                        res.write(`data: ${JSON.stringify({ reset: true, stage: 'content' })}\n\n`);
                        res.write(`data: ${JSON.stringify({ chunk: fullHtml, replay: true })}\n\n`);
                    }
                    break;
                }
            }

            const output = processGeneratedOutput({
                fullHtml,
                usePipeline,
                requestId,
                opciones,
                requestedSlides: slidesNum,
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
                vendorAssets
            });
            if (output.type === 'refused') {
                res.write(`data: ${JSON.stringify({ refused: true, message: output.message })}\n\n`);
            } else if (output.type === 'ended') {
                return;
            } else {
                const modelRoute = usePipeline ? pipelineResult?.stage3Stream?.modelRoute : selectedRoute;
                const effectiveModelRoute = repairRoute || modelRoute || {
                    requestedModelId: modelSelection.requestedModelId,
                    effectiveModelId: modelSelection.requestedModelId,
                    fallbackReason: null
                };
                const actualCost = req.creditReservation
                    ? quoteModel(modelSelection.model, output.deliveredSlides, slidesNum, normalizeMode(req.body)) : 0;
                if (req.creditReservation && !(await deps.creditsLedger.commit(req.creditReservation, actualCost))) {
                    throw new Error('USAGE_UNAVAILABLE');
                }
                res.write(`data: ${JSON.stringify({ done: true, html: output.html,
                    ...(output.deliveredSlides < slidesNum ? { warning: { code: 'SLIDES_INCOMPLETE',
                        requested: slidesNum, delivered: output.deliveredSlides } } : {}),
                    requestedModelId: effectiveModelRoute.requestedModelId,
                    effectiveModelId: effectiveModelRoute.effectiveModelId,
                    fallbackReason: effectiveModelRoute.fallbackReason })}\n\n`);
            }

            completed = true;
            res.end();
            creditDelivered = output.type === 'html';
        } catch (error) {
            if (cancelled || res.destroyed) return;
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
    deps.app.post('/generate', deps.upload.array('files', deps.maxUploadArrayFields), express.json({ limit: '50kb' }), deps.checkGenerationPressure, deps.validateModelRequest, deps.requireConversation, deps.checkRateLimits, deps.reserveGenerationCredits, async (req, res) => handler(req, res));
}

module.exports = { createGenerateHandler, registerGenerateRoute };
