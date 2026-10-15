'use strict';

const { resolveModelId } = require('../../config/model-catalog');
const { normalizeMode } = require('../../contracts/request-normalizers');
const { getRequestIp } = require('../../utils/credits-ledger');

function createConversationLockMiddleware({ store, create = false }) {
    return async function lockConversation(req, res, next) {
        const selection = resolveModelId(req.body?.modelId);
        if (!selection.valid) return next(); // Model validation returns the established model error.
        try {
            const result = await store.ensure({ conversationId: req.body?.conversationId,
                ip: getRequestIp(req), modelId: selection.model.id, mode: normalizeMode(req.body), create });
            if (!result.valid) {
                const status = result.code === 'CONVERSATION_CONFIG_MISMATCH' ? 409
                    : result.code === 'CONVERSATION_NOT_FOUND' ? 409 : 400;
                return res.status(status).json({ error: result.code, code: result.code,
                    ...(result.code === 'CONVERSATION_CONFIG_MISMATCH' ? { expected: {
                        modelId: result.modelId, mode: result.mode,
                    } } : {}) });
            }
            req.conversation = result.record;
            return next();
        } catch (_) {
            return res.status(503).json({ error: 'CONVERSATION_STORE_UNAVAILABLE', code: 'CONVERSATION_STORE_UNAVAILABLE' });
        }
    };
}

module.exports = { createConversationLockMiddleware };
