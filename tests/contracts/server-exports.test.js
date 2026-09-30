const test = require('node:test');
const assert = require('node:assert/strict');

const server = require('../../src/backend/server');

test('server facade exports remain frozen', () => {
    assert.deepEqual(Object.keys(server), [
        'app',
        'sanitizeTema',
        'sanitizeGeneratedHtml',
        'buildPrompt',
        'setTestProviderOverride',
        'clearTestProviderOverride'
    ]);
    assert.deepEqual(
        Object.fromEntries(Object.entries(server).map(([key, value]) => [key, typeof value])),
        {
            app: 'function',
            sanitizeTema: 'function',
            sanitizeGeneratedHtml: 'function',
            buildPrompt: 'function',
            setTestProviderOverride: 'function',
            clearTestProviderOverride: 'function'
        }
    );
});
