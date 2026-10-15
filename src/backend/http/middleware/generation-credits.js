'use strict';

const { resolveModelId, validateModelForGeneration } = require('../../config/model-catalog');
const { normalizeSlides, normalizeMode } = require('../../contracts/request-normalizers');
const { readRequestId, getRequestIp, resetAt } = require('../../utils/credits-ledger');

function quoteModel(model, slides, requestedSlides = slides, mode = 'flash') {
    const rate = model?.usagePerSlideUnits?.[mode];
    if (!Number.isSafeInteger(rate) || rate <= 0 || !Number.isSafeInteger(slides) || slides < 0
        || !Number.isSafeInteger(requestedSlides) || requestedSlides < slides) throw new Error('INVALID_MODEL_USAGE_RATE');
    return slides * rate;
}

function createGenerationCreditsMiddleware({ ledger }) {
    return async function reserveGenerationCredits(req, res, next) {
        const slides = normalizeSlides(req.body);
        if (!slides.valid) return next(); // The generation handler returns the existing validation error.
        const selection = resolveModelId(req.body?.modelId);
        if (!selection.valid) return next(); // The earlier model validator returns the model error.
        const compatibility = validateModelForGeneration(selection.model, normalizeMode(req.body), slides.slides);
        if (!compatibility.valid) return res.status(422).json({ error: compatibility.message, code: compatibility.code,
            maxSlides: compatibility.maxSlides });
        const mode = normalizeMode(req.body);
        const cost = quoteModel(selection.model, slides.slides, slides.slides, mode);
        const requestId = readRequestId(req);
        if (!requestId) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
        try {
            const reservation = await ledger.reserve(getRequestIp(req), cost, requestId);
            if (!reservation.allowed && reservation.code === 'INSUFFICIENT_USAGE') {
                return res.status(402).json({ error: 'INSUFFICIENT_USAGE', code: 'INSUFFICIENT_USAGE',
                    costUnits: cost, remainingUnits: reservation.remaining, resetsAt: resetAt(new Date()).toISOString(),
                    message: 'This presentation exceeds your remaining daily usage. Choose fewer slides, another model, or try again after the reset.' });
            }
            if (!reservation.allowed) {
                return res.status(409).json({ error: reservation.code || 'CREDIT_REQUEST_ALREADY_APPLIED' });
            }
            req.creditReservation = reservation;
            req.creditCost = cost;
            req.effectiveMode = mode;
            return next();
        } catch (_) {
            return res.status(503).json({ error: 'USAGE_UNAVAILABLE', message: 'Daily usage is temporarily unavailable. Try again shortly.' });
        }
    };
}

module.exports = { createGenerationCreditsMiddleware, quoteModel };
