/* eslint-disable max-lines-per-function, complexity */
const { resolveModelId, validateAttachments, validateModelForGeneration,
    isLocalNvidiaTrialRequest } = require('../config/model-catalog');
const { getRequestIp, readRequestId, resetAt } = require('../utils/credits-ledger');

/**
 * Build the skeleton-generation route handler without owning HTTP registration.
 * @param {{[key: string]: any}} deps pipeline dependencies and contract constants
 * @returns {Function} Express route handler
 */
function createSkeletonHandler(deps) {
    const {
        sanitizeTema,
        buildSkeletonFileContext,
        buildStage1Prompt,
        buildStage1RevisionPrompt,
        trySelectedStage1Thinking,
        extractJson,
        setSseHeaders,
        writeSse,
        invalidTopic,
        ERROR_TEXT,
        MAX_PRO_SLIDES,
        MAX_FLASH_SLIDES,
        log,
        ErrorCategory
    } = deps;

    return async function handleGenerateSkeleton(req, res) {
        const requestId = req.requestId || 'n/a';
        let cancelled = false;
        let creditReservation = null;
        let creditSettled = false;

        res.on('close', () => {
            if (res.writableEnded) return;
            cancelled = true;
        });

        res.on('error', (err) => {
            log.warn(ErrorCategory.STREAM, 'Skeleton response stream error, marking request cancelled', {
                requestId,
                error: String((err && err.message) || err)
            });
            cancelled = true;
        });

        try {
            const opciones = req.body || {};
            const modelSelection = resolveModelId(opciones.modelId, undefined,
                { localNvidiaTrial: isLocalNvidiaTrialRequest(req) });
            if (!modelSelection.valid) {
                await deps.discardUploadedFiles?.(req.files);
                return res.status(422).json({ error: modelSelection.message, code: modelSelection.code });
            }
            const mode = opciones.mode === 'pro' ? 'pro' : 'flash';
            const requestedSlides = Number(opciones.slides);
            if (Number.isSafeInteger(requestedSlides) && requestedSlides > 0) {
                const slideValidation = validateModelForGeneration(modelSelection.model, mode, requestedSlides);
                if (!slideValidation.valid) {
                    await deps.discardUploadedFiles?.(req.files);
                    return res.status(422).json({ error: slideValidation.message,
                        code: slideValidation.code, maxSlides: slideValidation.maxSlides });
                }
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
            const requestedLanguage = opciones.language || opciones.idioma || 'auto';
            const rawTema = opciones.tema || '';
            const sanitizeResult = sanitizeTema(String(rawTema));
            if (!sanitizeResult.valid) {
                return res.status(400).json(invalidTopic(sanitizeResult.reason));
            }

            const targetLang = requestedLanguage;
            const fileContext = await buildSkeletonFileContext(req.files);
            let currentSkeleton = opciones.currentSkeleton;
            if (currentSkeleton && typeof currentSkeleton === 'string') {
                try {
                    currentSkeleton = JSON.parse(currentSkeleton);
                } catch (e) {
                    // ignore parse errors
                }
            }

            const stage1Prompt = currentSkeleton && typeof currentSkeleton === 'object'
                ? buildStage1RevisionPrompt(sanitizeResult.tema, currentSkeleton, targetLang)
                : buildStage1Prompt(sanitizeResult.tema, targetLang);
            if (currentSkeleton && typeof currentSkeleton === 'object') {
                const idempotencyKey = readRequestId(req);
                if (!idempotencyKey) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
                try {
                    creditReservation = await deps.creditsLedger.reserve(getRequestIp(req), 1, idempotencyKey);
                } catch (_) {
                    return res.status(503).json({ error: 'CREDITS_UNAVAILABLE' });
                }
                if (!creditReservation.allowed && creditReservation.code === 'INSUFFICIENT_CREDITS') {
                    return res.status(402).json({ error: 'INSUFFICIENT_CREDITS', code: 'INSUFFICIENT_CREDITS',
                        cost: 1, remaining: creditReservation.remaining, resetsAt: resetAt(new Date()).toISOString(),
                        message: 'This chat update costs 1 credit. Wait for the daily reset or try again later.' });
                }
                if (!creditReservation.allowed) return res.status(409).json({ error: 'CREDIT_REQUEST_ALREADY_APPLIED' });
            } else {
                let schemaQuota;
                try {
                    schemaQuota = await deps.creditsLedger.reserveSchemaRequest(getRequestIp(req));
                } catch (_) {
                    return res.status(503).json({ error: 'CREDITS_UNAVAILABLE' });
                }
                if (schemaQuota.status === 'limit') {
                    return res.status(429).json({ error: 'SCHEMA_DAILY_LIMIT', code: 'SCHEMA_DAILY_LIMIT',
                        limit: schemaQuota.limit, resetsAt: schemaQuota.resetsAt,
                        message: 'You have used today’s 10 free outline requests. Try again after the daily reset.' });
                }
            }
            const stage1Response = await trySelectedStage1Thinking(stage1Prompt, fileContext,
                { selectedModel: modelSelection.model,
                    attachmentsRequireGemini: hasAttachments,
                    modelRoute: { requestedModelId: modelSelection.requestedModelId, effectiveModelId: null, fallbackReason: null } });

            setSseHeaders(res);
            if (stage1Response && stage1Response.provider && stage1Response.model) {
                try {
                    writeSse(res, { metadata: { provider: stage1Response.provider, model: stage1Response.model } });
                } catch (_) { /* ignore metadata write errors */ }
            }

            let stage1Raw = '';
            for await (const item of stage1Response.stream) {
                if (cancelled) {
                    log.warn(ErrorCategory.STREAM, 'Skeleton generation loop stopped because client disconnected', { requestId });
                    break;
                }
                if (item && typeof item === 'object' && typeof item.text === 'string') {
                    if (item.type === 'reasoning') {
                        writeSse(res, { reasoning: item.text });
                    } else {
                        stage1Raw += item.text;
                        writeSse(res, { chunk: item.text });
                    }
                } else if (typeof item === 'string') {
                    stage1Raw += item;
                    writeSse(res, { chunk: item });
                }
            }

            if (cancelled) return;

            let contentJson;
            try {
                contentJson = extractJson(stage1Raw);
            } catch (e) {
                res.write(`data: ${JSON.stringify({ error: `Failed to parse AI output as JSON: ${e.message}` })}\n\n`);
                res.end();
                return;
            }

            if (contentJson.rejected) {
                res.write(`data: ${JSON.stringify({ error: 'CONTENT_REJECTED: ' + (contentJson.reason || 'Invalid topic') })}\n\n`);
                res.end();
                return;
            }
            if (contentJson.action === 'proceed') {
                if (creditReservation && !(await deps.creditsLedger.commit(creditReservation))) throw new Error('CREDITS_UNAVAILABLE');
                if (creditReservation) creditSettled = true;
                res.write(`data: ${JSON.stringify({ done: true, skeleton: { action: 'proceed' } })}\n\n`);
                res.end();
                return;
            }
            if (!contentJson.slides || !Array.isArray(contentJson.slides) || contentJson.slides.length === 0) {
                writeSse(res, { error: 'STAGE1_INVALID: AI output has no slides array' });
                res.end();
                return;
            }

            const maxSlides = Math.min(mode === 'pro' ? MAX_PRO_SLIDES : MAX_FLASH_SLIDES,
                modelSelection.model.maxSlides?.[mode] || Infinity,
                Number.isSafeInteger(requestedSlides) && requestedSlides > 0 ? requestedSlides : Infinity);
            if (contentJson.slides.length > maxSlides) {
                contentJson.slides = contentJson.slides.slice(0, maxSlides);
                contentJson.slide_count = maxSlides;
            }

            if (creditReservation && !(await deps.creditsLedger.commit(creditReservation))) throw new Error('CREDITS_UNAVAILABLE');
            if (creditReservation) creditSettled = true;
            writeSse(res, { done: true, skeleton: contentJson });
            res.end();
        } catch (err) {
            log.error(ErrorCategory.PIPELINE, 'Failed to generate skeleton', { requestId, error: err.message });
            if (err.message === 'ATTACHMENTS_NOT_ALLOWED' || err.message === 'GEMINI_APP_CAP_REACHED') {
                await deps.discardUploadedFiles?.(req.files);
                const message = 'Attachments require Gemini and an available Gemini request today.';
                if (!res.headersSent) res.status(422).json({ error: message, code: 'ATTACHMENTS_NOT_ALLOWED' });
                else {
                    try { writeSse(res, { error: message, code: 'ATTACHMENTS_NOT_ALLOWED' }); res.end(); }
                    catch (e) { /* preserve the existing SSE error fallback */ }
                }
                return;
            }
            const providerError = err.message === 'PAID_PAUSED' || err.message === 'PROVIDER_UNAVAILABLE'
                || err.message === 'CREDITS_UNAVAILABLE';
            const message = providerError ? 'The AI providers are temporarily unavailable. Please try again later.' : ERROR_TEXT.OUTLINE_FAILED;
            if (!res.headersSent) {
                res.status(providerError ? 503 : 500).json(providerError ? { error: message, code: err.message } : { error: message });
            } else {
                try {
                    writeSse(res, providerError ? { error: message, code: err.message } : { error: message });
                    res.end();
                } catch (e) { /* preserve the existing SSE error fallback */ }
            }
        } finally {
            if (creditReservation && !creditSettled) {
                try { await deps.creditsLedger.refund(creditReservation); }
                catch (_) { log.error(ErrorCategory.NETWORK, 'Failed to refund chat credit reservation', { requestId }); }
            }
        }
    };
}

module.exports = { createSkeletonHandler };
