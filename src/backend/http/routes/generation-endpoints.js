const express = require('express');
const { registerGenerateRoute } = require('./generate');
const { createModelRequestValidationMiddleware } = require('../middleware/model-request-validation');
const { createGenerationCreditsMiddleware } = require('../middleware/generation-credits');
const { createConversationLockMiddleware } = require('../middleware/conversation-lock');

/**
 * Register all generation endpoints in their frozen order.
 *
 * @param {any} deps
 * @returns {void}
 */
function registerGenerationRoutes(deps) {
    const validateModelRequest = createModelRequestValidationMiddleware(deps);
    const reserveGenerationCredits = createGenerationCreditsMiddleware({ ledger: deps.creditsLedger });
    const requireConversation = createConversationLockMiddleware({ store: deps.conversationStore, create: false });
    deps.app.post('/generate-skeleton', deps.upload.array('files', deps.maxUploadArrayFields), express.json({ limit: '50kb' }), deps.checkGenerationPressure, validateModelRequest, deps.checkRateLimits, async (req, res) => deps.handleGenerateSkeleton(req, res));
    deps.app.post('/generate-outline-item', express.json({ limit: '8kb' }), deps.checkGenerationPressure,
        validateModelRequest, requireConversation, deps.checkRateLimits,
        async (req, res) => deps.handleGenerateOutlineItem(req, res));
    registerGenerateRoute({ ...deps, validateModelRequest, requireConversation, reserveGenerationCredits });
}

module.exports = { registerGenerationRoutes };
