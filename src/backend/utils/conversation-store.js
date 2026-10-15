'use strict';

const crypto = require('node:crypto');
const { getRedis } = require('./rate-limiter');

const CONVERSATION_TTL_SECONDS = 30 * 24 * 60 * 60;

function createConversationStore({ redis = getRedis, ttlSeconds = CONVERSATION_TTL_SECONDS } = {}) {
    const memory = new Map();

    function keyFor(conversationId, ip) {
        const owner = crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');
        return `{aedos-conversation-${owner}}:${conversationId}`;
    }

    // eslint-disable-next-line complexity -- Validate, create and compare one immutable server-side conversation record.
    async function ensure({ conversationId, ip, modelId, mode, create = true }) {
        if (typeof conversationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
            return { valid: false, code: 'CONVERSATION_ID_REQUIRED' };
        }
        if (typeof modelId !== 'string' || !['flash', 'pro'].includes(mode)) {
            return { valid: false, code: 'CONVERSATION_CONFIG_INVALID' };
        }
        const key = keyFor(conversationId, ip);
        const next = { conversationId, modelId, mode, createdAt: new Date().toISOString() };
        const client = redis();
        let record;
        if (!client) {
            record = memory.get(key);
            if (!record && create) { memory.set(key, next); record = next; }
        } else {
            if (create) await client.set(key, JSON.stringify(next), { nx: true, ex: ttlSeconds });
            const value = await client.get(key);
            if (value) {
                try { record = typeof value === 'string' ? JSON.parse(value) : value; }
                catch (_) { return { valid: false, code: 'CONVERSATION_STORE_INVALID' }; }
            }
        }
        if (!record) return { valid: false, code: 'CONVERSATION_NOT_FOUND' };
        if (record.modelId !== modelId || record.mode !== mode) {
            return { valid: false, code: 'CONVERSATION_CONFIG_MISMATCH', modelId: record.modelId, mode: record.mode };
        }
        return { valid: true, record };
    }

    return Object.freeze({ ensure, keyFor });
}

module.exports = { CONVERSATION_TTL_SECONDS, createConversationStore };
