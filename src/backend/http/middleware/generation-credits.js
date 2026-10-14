'use strict';

const { resolveModelId, isLocalNvidiaTrialRequest, validateModelForGeneration } = require('../../config/model-catalog');
const { normalizeSlides, normalizeMode } = require('../../contracts/request-normalizers');
const { readRequestId, getRequestIp, resetAt } = require('../../utils/credits-ledger');

function quoteModel(model, slides) {
    if (model.billing === 'perPresentation' && Number.isSafeInteger(model.creditsPerPresentation)) {
        return model.creditsPerPresentation;
    }
    if (model.billing === 'perSlide' && Number.isSafeInteger(model.creditsPerSlide)) {
        return slides * model.creditsPerSlide;
    }
    throw new Error('INVALID_MODEL_BILLING');
}

function createGenerationCreditsMiddleware({ ledger }) {
    return async function reserveGenerationCredits(req, res, next) {
        const slides = normalizeSlides(req.body);
        if (!slides.valid) return next(); // The generation handler returns the existing validation error.
        const selection = resolveModelId(req.body?.modelId, undefined,
            { localNvidiaTrial: isLocalNvidiaTrialRequest(req) });
        if (!selection.valid) return next(); // The earlier model validator returns the model error.
        const compatibility = validateModelForGeneration(selection.model, normalizeMode(req.body), slides.slides);
        if (!compatibility.valid) return res.status(422).json({ error: compatibility.message, code: compatibility.code,
            maxSlides: compatibility.maxSlides });
        const cost = quoteModel(selection.model, slides.slides);
        const requestId = readRequestId(req);
        if (!requestId) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
        try {
            const reservation = await ledger.reserve(getRequestIp(req), cost, requestId);
            if (!reservation.allowed && reservation.code === 'INSUFFICIENT_CREDITS') {
                return res.status(402).json({ error: 'INSUFFICIENT_CREDITS', code: 'INSUFFICIENT_CREDITS',
                    cost, remaining: reservation.remaining, resetsAt: resetAt(new Date()).toISOString(),
                    message: 'Choose a lower-cost model or fewer slides, or try again after the daily reset.' });
            }
            if (!reservation.allowed) {
                return res.status(409).json({ error: reservation.code || 'CREDIT_REQUEST_ALREADY_APPLIED' });
            }
            req.creditReservation = reservation;
            req.creditCost = cost;
            req.effectiveMode = normalizeMode(req.body);
            return next();
        } catch (_) {
            return res.status(503).json({ error: 'CREDITS_UNAVAILABLE', message: 'Credits are temporarily unavailable. Try again shortly.' });
        }
    };
}

module.exports = { createGenerationCreditsMiddleware, quoteModel };
