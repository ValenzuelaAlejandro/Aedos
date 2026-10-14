'use strict';

const { resolveModelId, validateAttachments, isLocalNvidiaTrialRequest } = require('../../config/model-catalog');

function createModelRequestValidationMiddleware({ hasGeminiRequestAvailable, discardUploadedFiles }) {
    return async function validateModelRequest(req, res, next) {
        const selection = resolveModelId(req.body?.modelId, undefined,
            { localNvidiaTrial: isLocalNvidiaTrialRequest(req) });
        if (!selection.valid) {
            await discardUploadedFiles?.(req.files);
            return res.status(422).json({ error: selection.message, code: selection.code });
        }

        const hasAttachments = Array.isArray(req.files) && req.files.length > 0;
        if (hasAttachments) {
            const geminiAvailable = await hasGeminiRequestAvailable?.() === true;
            const validation = validateAttachments(selection.model, true, geminiAvailable);
            if (!validation.valid) {
                await discardUploadedFiles?.(req.files);
                return res.status(422).json({ error: validation.message, code: validation.code });
            }
        }
        return next();
    };
}

module.exports = { createModelRequestValidationMiddleware };
