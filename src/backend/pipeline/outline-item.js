'use strict';

const { resolveModelId } = require('../config/model-catalog');
const { normalizeMode } = require('../contracts/request-normalizers');
const { getRequestIp, readRequestId } = require('../utils/credits-ledger');
const { countTokens, chatUsageUnits, reserveChatUsageUnits, MAX_CHAT_OUTPUT_TOKENS } = require('../config/usage-policy');

function buildPrompt(type, topic, context, deps) {
    if (type === 'slide') return deps.buildAddSlidePrompt(topic, context.existingSlides);
    if (type === 'point') {
        return deps.buildAddPointPrompt(topic, context.slideTitle, context.slideSubtitle, context.existingPoints);
    }
    return null;
}

function normalizeItem(itemJson) {
    if (!itemJson || typeof itemJson !== 'object') throw new Error('Invalid AI response format for outline item');
    if (!itemJson.title) itemJson.title = '';
    if (!itemJson.role) itemJson.role = 'concept';
    if (!Array.isArray(itemJson.key_points)) itemJson.key_points = [];
    return itemJson;
}

function createOutlineItemHandler(deps) {
    const { buildAddSlidePrompt, buildAddPointPrompt, trySelectedStage1Thinking, extractJson, ERROR_TEXT, log, ErrorCategory } = deps;

    // eslint-disable-next-line complexity -- Keep the response reservation through successful JSON delivery.
    return async function handleGenerateOutlineItem(req, res) {
        const requestId = req.requestId || 'n/a';
        let reservation = null;
        let settled = false;
        try {
            const { type, topic, ...context } = req.body;
            const selection = resolveModelId(req.body?.modelId);
            if (!selection.valid) return res.status(422).json({ error: selection.message, code: selection.code });
            const mode = normalizeMode(req.body);
            const prompt = buildPrompt(type, topic, context, { buildAddSlidePrompt, buildAddPointPrompt });
            if (!prompt) return res.status(400).json({ error: ERROR_TEXT.INVALID_ITEM_TYPE });
            const requestIdempotency = readRequestId(req);
            if (!requestIdempotency) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
            const inputTokens = countTokens(prompt);
            if (inputTokens > 12_288) return res.status(413).json({ error: 'CHAT_CONTEXT_LIMIT', code: 'CHAT_CONTEXT_LIMIT' });
            const reserveUnits = reserveChatUsageUnits(selection.model.id, mode, inputTokens, MAX_CHAT_OUTPUT_TOKENS);
            reservation = await deps.creditsLedger.reserve(getRequestIp(req), reserveUnits, requestIdempotency);
            if (!reservation.allowed && reservation.code === 'INSUFFICIENT_USAGE') {
                return res.status(402).json({ error: 'INSUFFICIENT_USAGE', code: 'INSUFFICIENT_USAGE',
                    costUnits: reserveUnits, remainingUnits: reservation.remaining });
            }
            if (!reservation.allowed) return res.status(409).json({ error: reservation.code || 'USAGE_REQUEST_ALREADY_APPLIED' });

            const result = await trySelectedStage1Thinking(prompt, null, { selectedModel: selection.model,
                expectedOutput: 'outline-item', maxOutputTokens: MAX_CHAT_OUTPUT_TOKENS, includeReasoning: false,
                modelRoute: { requestedModelId: selection.model.id, effectiveModelId: null, fallbackReason: null } });
            let rawOutput = '', usage = null;
            for await (const item of result.stream) {
                if (item?.type === 'reset') { rawOutput = ''; usage = null; }
                else if (item?.type === 'usage') usage = item.usage || null;
                else if (typeof item === 'string') rawOutput += item;
                else if (typeof item?.text === 'string' && item.type !== 'reasoning') rawOutput += item.text;
            }
            let itemJson;
            try { itemJson = normalizeItem(extractJson(rawOutput)); }
            catch (error) { throw new Error(`OUTLINE_ITEM_INVALID: ${error.message}`, { cause: error }); }
            const actualUsageUnits = chatUsageUnits(selection.model.id, mode,
                usage?.inputTokens ?? inputTokens, usage?.outputTokens ?? countTokens(rawOutput));
            if (!(await deps.creditsLedger.commit(reservation, actualUsageUnits))) throw new Error('USAGE_UNAVAILABLE');
            settled = true;
            await deps.recordChatUsage?.({ requestId, modelId: selection.model.id, mode,
                inputTokens: usage?.inputTokens ?? inputTokens, outputTokens: usage?.outputTokens ?? countTokens(rawOutput),
                usageUnits: actualUsageUnits, estimated: !usage?.reported });
            return res.json({ item: itemJson });
        } catch (err) {
            log.error(ErrorCategory.PIPELINE, 'Failed to generate outline item', { requestId, error: err.message });
            const spendLimit = ['PAID_PAUSED', 'IP_SPEND_LIMIT', 'REQUEST_SPEND_LIMIT', 'REQUEST_ATTEMPT_LIMIT',
                'SPEND_GUARD_UNAVAILABLE'].includes(err.message);
            const requestTimeout = ['REQUEST_TIMEOUT', 'REQUEST_TOTAL_TIMEOUT', 'PROVIDER_REQUEST_TIMEOUT'].includes(err.message);
            const unavailable = spendLimit || err.message === 'PROVIDER_UNAVAILABLE' || err.message === 'USAGE_UNAVAILABLE';
            const code = spendLimit ? 'AI_SPEND_LIMIT' : err.message === 'USAGE_UNAVAILABLE'
                ? 'USAGE_UNAVAILABLE' : unavailable ? 'PROVIDER_UNAVAILABLE' : null;
            const message = spendLimit ? err.message === 'IP_SPEND_LIMIT'
                ? 'This network has reached its daily AI budget. No usage was deducted; please try again after the reset.'
                : 'The application has reached its daily AI budget. No usage was deducted; please try again after the reset.'
                : requestTimeout ? 'This request reached its maximum processing time. No usage was deducted; please try again.'
                : unavailable ? 'The AI providers are temporarily unavailable. Please try again later.' : ERROR_TEXT.ITEM_FAILED;
            return res.status(unavailable ? 503 : 500).json({ error: message, ...(code ? { code } : {}) });
        } finally {
            if (reservation?.allowed && !settled) {
                try { await deps.creditsLedger.refund(reservation); }
                catch (_) { log.error(ErrorCategory.NETWORK, 'Failed to refund outline-item usage reservation', { requestId }); }
            }
        }
    };
}

module.exports = { createOutlineItemHandler, buildPrompt, normalizeItem };
