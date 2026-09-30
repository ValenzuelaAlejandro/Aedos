/* eslint-disable max-lines-per-function, complexity */

const express = require('express');
const { processGeneratedOutput } = require('./generate-output');
const { handleGenerationError } = require('./generate-errors');

/**
 * Create the main generation endpoint handler.
 *
 * @param {any} deps generation dependencies
 * @returns {Function}
 */
function createGenerateHandler(deps) {
    return async function(req, res) {
        let cancelled = false;
        let completed = false;
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
            const opciones = req.body;
            const requestedLanguage = req.body.language || req.body.idioma || 'auto';
            if (opciones.skeleton && typeof opciones.skeleton === 'string') {
                try {
                    opciones.skeleton = JSON.parse(opciones.skeleton);
                } catch (e) {
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
                mode: req.body.mode === 'pro' ? 'pro' : 'flash',
                idioma: requestedLanguage,
                requestedSlides: req.body.slides
            });

            const rawTema = opciones.tema || '';
            const sanitizeResult = deps.sanitizeTema(String(rawTema));
            if (!sanitizeResult.valid) {
                deps.log.warn(deps.ErrorCategory.VALIDATION, 'Topic rejected by sanitizer', { requestId, reason: sanitizeResult.reason });
                return res.status(400).json(deps.invalidTopic(sanitizeResult.reason));
            }

            const targetLang = requestedLanguage;
            opciones.targetLanguage = targetLang;
            opciones.tema = sanitizeResult.tema;
            const usePipeline = req.body.mode === 'pro';

            let slidesNum = (req.body.slides !== undefined && req.body.slides !== 'undefined') ? parseInt(req.body.slides, 10) : 5;
            if (isNaN(slidesNum) || slidesNum < 1 || slidesNum > 15) {
                deps.log.warn(deps.ErrorCategory.VALIDATION, 'Slides validation failed', { requestId, slides: req.body.slides });
                return res.status(422).json(deps.validationFailed({ slides: 'must be integer between 1 and 15' }));
            }

            const slideHardLimit = usePipeline ? deps.MAX_PRO_SLIDES : deps.MAX_FLASH_SLIDES;
            if (slidesNum > slideHardLimit) {
                deps.log.warn(deps.ErrorCategory.VALIDATION, 'Slides capped to mode hard limit', {
                    requestId,
                    requestedSlides: slidesNum,
                    appliedLimit: slideHardLimit
                });
                slidesNum = slideHardLimit;
                opciones.slides = slidesNum;
            }

            const VALID_IDIOMAS = ['es', 'en', 'fr', 'pt', 'de'];
            const idiomaVal = req.body.idioma || 'es';
            if (!VALID_IDIOMAS.includes(idiomaVal)) {
                deps.log.warn(deps.ErrorCategory.VALIDATION, 'Language validation failed', { requestId, idioma: idiomaVal });
                return res.status(422).json(deps.validationFailed({ idioma: 'must be one of: es, en, fr, pt, de' }));
            }

            if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY) {
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

            if (!usePipeline) {
                const flashOut = await deps.runFlashGenerationWithRetry({
                    cancelledRef: () => cancelled,
                    res,
                    requestId,
                    opciones,
                    fileContext,
                    slideHardLimit,
                    tryModelsFlash: deps.tryModelsFlash,
                    buildPrompt: deps.buildPrompt,
                    log: deps.log,
                    ErrorCategory: deps.ErrorCategory,
                    consumeStream: (streamResult, response, id, cancelledRef, hardLimit) => deps.consumeModelStream(
                        { log: deps.log, ErrorCategory: deps.ErrorCategory }, streamResult, response, id, cancelledRef, hardLimit
                    )
                });
                fullHtml = flashOut.fullHtml;
                hasStartedValidContent = flashOut.hasStartedValidContent;
            } else {
                deps.log.info(deps.ErrorCategory.PIPELINE, 'Running pro pipeline path', { requestId });
                res.write(`data: ${JSON.stringify({ pipeline: true, stage: 'content', status: 'running' })}\n\n`);
                const pipelineResult = await deps.runPipeline({
                    rawInput: opciones.tema,
                    targetLanguage: targetLang,
                    fileContext,
                    skeleton: opciones.skeleton,
                    maxSlides: slideHardLimit,
                    tryModelsStage1: deps.tryModelsStage1Thinking,
                    tryModelsStage2: deps.tryModelsStage2Thinking,
                    tryModelsStage3: deps.tryModelsStage3Thinking,
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
                examplesProDir: deps.EXAMPLES_PRO_DIR
            });
            if (output.type === 'refused') {
                res.write(`data: ${JSON.stringify({ refused: true, message: output.message })}\n\n`);
            } else if (output.type === 'ended') {
                return;
            } else {
                res.write(`data: ${JSON.stringify({ done: true, html: output.html })}\n\n`);
            }

            completed = true;
            res.end();
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
    deps.app.post('/generate', deps.upload.array('files', deps.maxUploadArrayFields), express.json({ limit: '50kb' }), deps.checkGenerationPressure, deps.checkRateLimits, async (req, res) => handler(req, res));
}

module.exports = { createGenerateHandler, registerGenerateRoute };
