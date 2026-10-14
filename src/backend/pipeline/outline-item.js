/**
 * Build the outline-item generation route handler.
 * @param {{[key: string]: any}} deps pipeline dependencies and contract constants
 * @returns {Function} Express route handler
 */
const { getRequestIp, readRequestId, resetAt } = require('../utils/credits-ledger');

function buildPrompt(type, topic, context, deps) {
    if (type === 'slide') return deps.buildAddSlidePrompt(topic, context.existingSlides);
    if (type === 'point') {
        return deps.buildAddPointPrompt(topic, context.slideTitle, context.slideSubtitle, context.existingPoints);
    }
    return null;
}

async function reserveCredit(req, res, deps) {
    const idempotencyKey = readRequestId(req);
    if (!idempotencyKey) {
        res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
        return null;
    }
    const reservation = await deps.creditsLedger.reserve(getRequestIp(req), 1, idempotencyKey);
    if (!reservation.allowed && reservation.code === 'INSUFFICIENT_CREDITS') {
        res.status(402).json({ error: 'INSUFFICIENT_CREDITS', code: 'INSUFFICIENT_CREDITS',
            cost: 1, remaining: reservation.remaining, resetsAt: resetAt(new Date()).toISOString(),
            message: 'Adding an outline item costs 1 credit. Wait for the daily reset or try again later.' });
        return null;
    }
    if (!reservation.allowed) {
        res.status(409).json({ error: 'CREDIT_REQUEST_ALREADY_APPLIED' });
        return null;
    }
    return reservation;
}

function normalizeItem(itemJson) {
    if (!itemJson || typeof itemJson !== 'object') throw new Error('Invalid AI response format for outline item');
    if (!itemJson.title) itemJson.title = '';
    if (!itemJson.role) itemJson.role = 'concept';
    if (!Array.isArray(itemJson.key_points)) itemJson.key_points = [];
    return itemJson;
}

function createOutlineItemHandler(deps) {
    const {
        buildAddSlidePrompt,
        buildAddPointPrompt,
        tryModelsStage1,
        extractJson,
        ERROR_TEXT,
        log,
        ErrorCategory
    } = deps;

    return async function handleGenerateOutlineItem(req, res) {
        const requestId = req.requestId || 'n/a';
        let reservation = null;
        let settled = false;
        try {
            const { type, topic, ...context } = req.body;
            const prompt = buildPrompt(type, topic, context,
                { buildAddSlidePrompt, buildAddPointPrompt });
            if (!prompt) return res.status(400).json({ error: ERROR_TEXT.INVALID_ITEM_TYPE });
            reservation = await reserveCredit(req, res, deps);
            if (!reservation) return res;

            const rawOutputResponse = await tryModelsStage1(prompt, null);
            let rawOutput = '';
            for await (const chunk of rawOutputResponse.stream) {
                rawOutput += chunk;
            }

            let itemJson;
            try {
                itemJson = extractJson(rawOutput);
            } catch (e) {
                // eslint-disable-next-line preserve-caught-error
                throw new Error(`Failed to parse AI output as JSON: ${e.message}`);
            }

            itemJson = normalizeItem(itemJson);

            if (!(await deps.creditsLedger.commit(reservation))) throw new Error('CREDITS_UNAVAILABLE');
            settled = true;
            res.json({ item: itemJson });
        } catch (err) {
            log.error(ErrorCategory.PIPELINE, 'Failed to generate outline item', { requestId, error: err.message });
            const providerError = err.message === 'PAID_PAUSED' || err.message === 'PROVIDER_UNAVAILABLE'
                || err.message === 'CREDITS_UNAVAILABLE';
            res.status(providerError ? 503 : 500).json(providerError
                ? { error: 'The AI providers are temporarily unavailable. Please try again later.', code: err.message }
                : { error: ERROR_TEXT.ITEM_FAILED });
        } finally {
            if (reservation && !settled) {
                try { await deps.creditsLedger.refund(reservation); }
                catch (_) { log.error(ErrorCategory.NETWORK, 'Failed to refund outline-item credit reservation', { requestId }); }
            }
        }
    };
}

module.exports = { createOutlineItemHandler };
