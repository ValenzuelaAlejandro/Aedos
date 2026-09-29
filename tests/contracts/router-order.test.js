const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'router-snapshot-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';

const { app } = require('../../src/backend/server');
const snapshotPath = path.join(__dirname, '..', 'fixtures', 'contracts', 'router-order.json');

function routerOrder() {
    return app._router.stack
        .filter((layer) => layer.route || layer.name)
        .map((layer) => layer.route
            ? {
                type: 'route',
                path: layer.route.path,
                methods: Object.keys(layer.route.methods),
                stack: layer.route.stack.map((handler) => handler.name),
            }
            : { type: 'middleware', name: layer.name, regexp: String(layer.regexp) });
}

test('Express middleware and route order remains frozen', () => {
    const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    assert.deepEqual(routerOrder(), expected);
});
