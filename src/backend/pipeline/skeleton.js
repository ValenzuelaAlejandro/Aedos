/* eslint-disable max-lines-per-function, complexity */
const { resolveModelId, validateAttachments, validateModelForGeneration } = require('../config/model-catalog');
const { getRequestIp, readRequestId, resetAt } = require('../utils/credits-ledger');
const { normalizeMode, normalizeSlides } = require('../contracts/request-normalizers');
const { completeOutlineSlides } = require('./outline-completion');
const { createConversationStore } = require('../utils/conversation-store');
const { normalizeValidatedLanguage } = require('../contracts/request-normalizers');
const { countTokens, chatUsageUnits, reserveChatUsageUnits, MAX_CHAT_INPUT_TOKENS,
    MAX_CHAT_OUTPUT_TOKENS } = require('../config/usage-policy');

/**
 * Build the skeleton-generation route handler without owning HTTP registration.
 * @param {{[key: string]: any}} deps pipeline dependencies and contract constants
 * @returns {Function} Express route handler
 */
function createSkeletonHandler(deps) {
    const conversationStore = deps.conversationStore || createConversationStore({ redis: () => null });
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
        log,
        ErrorCategory
    } = deps;

    return async function handleGenerateSkeleton(req, res) {
        const requestId = req.requestId || 'n/a';
        let cancelled = false;
        let creditReservation = null;
        let creditSettled = false;
        let schemaReservation = null;
        let schemaSettled = false;
        let tokenBudget;
        let heartbeat = null;

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
            const modelSelection = resolveModelId(opciones.modelId);
            if (!modelSelection.valid) {
                await deps.discardUploadedFiles?.(req.files);
                return res.status(422).json({ error: modelSelection.message, code: modelSelection.code });
            }
            const mode = normalizeMode(opciones);
            const slidesValidation = normalizeSlides({ ...opciones, mode });
            if (!slidesValidation.valid) {
                await deps.discardUploadedFiles?.(req.files);
                return res.status(422).json({ error: 'Invalid slide count.', code: 'INVALID_SLIDE_COUNT',
                    fields: slidesValidation.fields, maxSlides: slidesValidation.maxSlides });
            }
            const requestedSlides = slidesValidation.slides;
            const slideValidation = validateModelForGeneration(modelSelection.model, mode, requestedSlides);
            if (!slideValidation.valid) {
                await deps.discardUploadedFiles?.(req.files);
                return res.status(422).json({ error: slideValidation.message,
                    code: slideValidation.code, maxSlides: slideValidation.maxSlides });
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
            const languageResult = normalizeValidatedLanguage(opciones);
            if (!languageResult.valid) return res.status(422).json({ error: 'INVALID_LANGUAGE', code: 'INVALID_LANGUAGE', fields: languageResult.fields });
            const requestedLanguage = languageResult.idioma;
            const rawTema = opciones.tema || '';
            const sanitizeResult = sanitizeTema(String(rawTema));
            if (!sanitizeResult.valid) {
                return res.status(400).json(invalidTopic(sanitizeResult.reason));
            }

            const conversation = await conversationStore.ensure({ conversationId: opciones.conversationId,
                ip: getRequestIp(req), modelId: modelSelection.model.id, mode, create: true });
            if (!conversation.valid) {
                const status = conversation.code === 'CONVERSATION_CONFIG_MISMATCH' ? 409 : 400;
                return res.status(status).json({ error: conversation.code, code: conversation.code });
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
                ? buildStage1RevisionPrompt(sanitizeResult.tema, currentSkeleton, targetLang, requestedSlides)
                : buildStage1Prompt(sanitizeResult.tema, targetLang, requestedSlides);
            const idempotencyKey = readRequestId(req);
            if (!idempotencyKey) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
            const promptTokens = countTokens(stage1Prompt);
            if (promptTokens > MAX_CHAT_INPUT_TOKENS) return res.status(413).json({ error: 'CHAT_CONTEXT_LIMIT', code: 'CHAT_CONTEXT_LIMIT' });
            const reserveUnits = reserveChatUsageUnits(modelSelection.model.id, mode,
                MAX_CHAT_INPUT_TOKENS, MAX_CHAT_OUTPUT_TOKENS);
            try {
                creditReservation = await deps.creditsLedger.reserve(getRequestIp(req), reserveUnits, idempotencyKey);
            } catch (_) { return res.status(503).json({ error: 'USAGE_UNAVAILABLE' }); }
            if (!creditReservation.allowed && creditReservation.code === 'INSUFFICIENT_USAGE') {
                return res.status(402).json({ error: 'INSUFFICIENT_USAGE', code: 'INSUFFICIENT_USAGE',
                    costUnits: reserveUnits, remainingUnits: creditReservation.remaining, resetsAt: resetAt(new Date()).toISOString() });
            }
            if (!creditReservation.allowed) return res.status(409).json({ error: 'USAGE_REQUEST_ALREADY_APPLIED' });
            if (!(currentSkeleton && typeof currentSkeleton === 'object')) {
                schemaReservation = await deps.creditsLedger.reserveSchemaRequest(getRequestIp(req), idempotencyKey);
                if (schemaReservation.status === 'limit') {
                    return res.status(429).json({ error: 'SCHEMA_DAILY_LIMIT', code: 'SCHEMA_DAILY_LIMIT',
                        limit: schemaReservation.limit, resetsAt: schemaReservation.resetsAt,
                        message: 'You have reached today’s 10-outline safety limit. Try again after the daily reset.' });
                }
                if (schemaReservation.status !== 'allowed') return res.status(409).json({ error: 'SCHEMA_REQUEST_ALREADY_APPLIED' });
            }
            tokenBudget = { inputTokens: MAX_CHAT_INPUT_TOKENS, outputTokens: MAX_CHAT_OUTPUT_TOKENS,
                usedInputTokens: 0, usedOutputTokens: 0, estimated: false,
                record(usage) {
                    const input = Number(usage?.inputTokens) || 0, output = Number(usage?.outputTokens) || 0;
                    if (this.usedInputTokens + input > this.inputTokens || this.usedOutputTokens + output > this.outputTokens) {
                        throw new Error('CHAT_CONTEXT_LIMIT');
                    }
                    this.usedInputTokens += input; this.usedOutputTokens += output;
                    this.estimated ||= Boolean(usage?.estimated);
                } };
            heartbeat = setInterval(() => {
                if (cancelled || res.writableEnded || res.destroyed) return;
                try {
                    if (!res.headersSent) setSseHeaders(res);
                    writeSse(res, { heartbeat: true });
                } catch (_) { cancelled = true; }
            }, 15000);
            const stage1Response = await trySelectedStage1Thinking(stage1Prompt, fileContext,
                { selectedModel: modelSelection.model, expectedOutput: 'outline',
                    expectedSlides: requestedSlides,
                    maxOutputTokens: MAX_CHAT_OUTPUT_TOKENS,
                    attachmentsRequireGemini: hasAttachments,
                    modelRoute: { requestedModelId: modelSelection.requestedModelId, effectiveModelId: null, fallbackReason: null } });

            if (!res.headersSent) setSseHeaders(res);
            if (stage1Response && stage1Response.provider && stage1Response.model) {
                try {
                    writeSse(res, { metadata: { provider: stage1Response.provider, model: stage1Response.model } });
                } catch (_) { /* ignore metadata write errors */ }
            }

            let stage1Raw = '';
            let stage1Usage = null;
            for await (const item of stage1Response.stream) {
                if (cancelled) {
                    log.warn(ErrorCategory.STREAM, 'Skeleton generation loop stopped because client disconnected', { requestId });
                    break;
                }
                if (item?.type === 'reset') {
                    stage1Raw = '';
                    stage1Usage = null;
                    writeSse(res, { reset: true, stage: item.stage, attempt: item.attempt });
                    continue;
                }
                if (item?.type === 'usage') { stage1Usage = item.usage || null; continue; }
                if (item?.type === 'metadata') {
                    writeSse(res, { metadata: { provider: item.provider, model: item.model } });
                    continue;
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
            tokenBudget.record({ inputTokens: stage1Usage?.inputTokens ?? promptTokens,
                outputTokens: stage1Usage?.outputTokens ?? countTokens(stage1Raw), estimated: !stage1Usage?.reported });
            if (contentJson.action === 'proceed') {
                const actualUsageUnits = chatUsageUnits(modelSelection.model.id, mode,
                    tokenBudget.usedInputTokens, tokenBudget.usedOutputTokens);
                if (creditReservation && !(await deps.creditsLedger.commit(creditReservation, actualUsageUnits))) throw new Error('USAGE_UNAVAILABLE');
                if (creditReservation) creditSettled = true;
                if (schemaReservation && !(await deps.creditsLedger.commitSchemaRequest(schemaReservation))) throw new Error('USAGE_UNAVAILABLE');
                if (schemaReservation) schemaSettled = true;
                await deps.recordChatUsage?.({ requestId, modelId: modelSelection.model.id, mode,
                    inputTokens: tokenBudget.usedInputTokens, outputTokens: tokenBudget.usedOutputTokens,
                    usageUnits: actualUsageUnits, estimated: tokenBudget.estimated });
                res.write(`data: ${JSON.stringify({ done: true, skeleton: { action: 'proceed' } })}\n\n`);
                res.end();
                return;
            }
            if (!contentJson.slides || !Array.isArray(contentJson.slides) || contentJson.slides.length === 0) {
                writeSse(res, { error: 'STAGE1_INVALID: AI output has no slides array' });
                res.end();
                return;
            }

            if (contentJson.action !== 'proceed' && contentJson.slides.length !== requestedSlides) {
                writeSse(res, { reset: true, stage: 'stage1' });
                contentJson = await completeOutlineSlides({
                    contentJson,
                    requestedSlides,
                    rawInput: sanitizeResult.tema,
                    targetLanguage: targetLang,
                    callModel: deps.trySelectedStage1Thinking,
                    fileContext,
                    extractJson,
                    selectedModel: modelSelection.model,
                    tokenBudget,
                    onChunk: item => {
                        if (item?.type === 'reasoning') writeSse(res, { reasoning: item.text });
                        else if (item?.type === 'content') writeSse(res, { chunk: item.text });
                        else if (item?.type === 'reset') writeSse(res, { reset: true, stage: 'stage1', attempt: item.attempt });
                    }
                });
            }

            const actualUsageUnits = chatUsageUnits(modelSelection.model.id, mode,
                tokenBudget.usedInputTokens, tokenBudget.usedOutputTokens);
            if (creditReservation && !(await deps.creditsLedger.commit(creditReservation, actualUsageUnits))) throw new Error('USAGE_UNAVAILABLE');
            if (creditReservation) creditSettled = true;
            if (schemaReservation && !(await deps.creditsLedger.commitSchemaRequest(schemaReservation))) throw new Error('USAGE_UNAVAILABLE');
            if (schemaReservation) schemaSettled = true;
            await deps.recordChatUsage?.({ requestId, modelId: modelSelection.model.id, mode,
                inputTokens: tokenBudget.usedInputTokens, outputTokens: tokenBudget.usedOutputTokens,
                usageUnits: actualUsageUnits, estimated: tokenBudget.estimated });
            writeSse(res, { done: true, skeleton: contentJson });
            res.end();
        } catch (err) {
            if (cancelled || res.destroyed) return;
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
            const spendLimit = ['PAID_PAUSED', 'IP_SPEND_LIMIT', 'REQUEST_SPEND_LIMIT', 'REQUEST_ATTEMPT_LIMIT',
                'SPEND_GUARD_UNAVAILABLE'].includes(err.message);
            const requestTimeout = ['REQUEST_TIMEOUT', 'REQUEST_TOTAL_TIMEOUT', 'PROVIDER_REQUEST_TIMEOUT'].includes(err.message);
            const providerError = spendLimit || err.message === 'PROVIDER_UNAVAILABLE'
                || err.message === 'USAGE_UNAVAILABLE' || err.message === 'REQUEST_ATTEMPT_LIMIT' || requestTimeout;
            const message = spendLimit ? err.message === 'IP_SPEND_LIMIT'
                ? 'This network has reached its daily AI budget. No usage was deducted; please try again after the reset.'
                : 'The application has reached its daily AI budget. No usage was deducted; please try again after the reset.'
                : err.message === 'REQUEST_ATTEMPT_LIMIT' ? 'This request reached its safe provider-attempt limit. No usage was deducted; please try again.'
                : requestTimeout ? 'This request reached its maximum processing time. No usage was deducted; please try again.'
                : err.message === 'CHAT_CONTEXT_LIMIT' ? 'This conversation is too long for one response. Start a new conversation or shorten your request.'
                : err.message === 'PROVIDER_SAFETY'
                ? 'The selected model could not complete this request because of its safety filters. Please rephrase your request.'
                : providerError ? 'The AI providers are temporarily unavailable. Please try again later.' : ERROR_TEXT.OUTLINE_FAILED;
            if (!res.headersSent) {
                res.status(providerError ? 503 : 500).json(providerError ? { error: message, code: err.message } : { error: message });
            } else {
                try {
                    writeSse(res, providerError ? { error: message, code: err.message } : { error: message });
                    res.end();
                } catch (e) { /* preserve the existing SSE error fallback */ }
            }
        } finally {
            if (heartbeat) clearInterval(heartbeat);
            if (creditReservation && !creditSettled) {
                try { await deps.creditsLedger.refund(creditReservation); }
                catch (_) { log.error(ErrorCategory.NETWORK, 'Failed to refund chat usage reservation', { requestId }); }
            }
            if (schemaReservation && !schemaSettled) {
                try { await deps.creditsLedger.refundSchemaRequest(schemaReservation); }
                catch (_) { log.error(ErrorCategory.NETWORK, 'Failed to release outline safety reservation', { requestId }); }
            }
        }
    };
}

module.exports = { createSkeletonHandler };
