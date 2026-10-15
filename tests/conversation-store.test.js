const assert = require('node:assert/strict');
const test = require('node:test');
const { createConversationStore } = require('../src/backend/utils/conversation-store');

const conversationId = 'f5831ae9-d3a5-4ce5-917a-990bdd40a1bc';

test('conversation settings are created once and only model and mode are immutable', async () => {
    const store = createConversationStore({ redis: () => null });
    const first = await store.ensure({ conversationId, ip: '203.0.113.7', modelId: 'google/gemini-3-flash-preview', mode: 'flash', create: true });
    assert.equal(first.valid, true);
    const same = await store.ensure({ conversationId, ip: '203.0.113.7', modelId: first.record.modelId, mode: 'flash', create: false });
    assert.equal(same.valid, true);
    assert.deepEqual(Object.keys(same.record).sort(), ['conversationId', 'createdAt', 'mode', 'modelId']);
    assert.equal((await store.ensure({ conversationId, ip: '203.0.113.7', modelId: 'openai/gpt-6-luna', mode: 'flash', create: false })).code,
        'CONVERSATION_CONFIG_MISMATCH');
    assert.equal((await store.ensure({ conversationId, ip: '203.0.113.7', modelId: first.record.modelId, mode: 'pro', create: false })).code,
        'CONVERSATION_CONFIG_MISMATCH');
});

test('conversation IDs are scoped to the IP hash and validated as UUIDs', async () => {
    const store = createConversationStore({ redis: () => null });
    assert.equal((await store.ensure({ conversationId: 'bad-id', ip: '203.0.113.7', modelId: 'google/gemini-3-flash-preview', mode: 'flash' })).code,
        'CONVERSATION_ID_REQUIRED');
    await store.ensure({ conversationId, ip: '203.0.113.7', modelId: 'google/gemini-3-flash-preview', mode: 'flash' });
    assert.equal((await store.ensure({ conversationId, ip: '203.0.113.8', modelId: 'google/gemini-3-flash-preview', mode: 'flash', create: false })).code,
        'CONVERSATION_NOT_FOUND');
});
