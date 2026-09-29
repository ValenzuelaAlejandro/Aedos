const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('provider stub is explicitly restricted to non-production test mode', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'backend', 'server.js'), 'utf8');
    assert.match(source, /process\.env\.NODE_ENV !== ['"]production['"] && process\.env\.AEDOS_TEST_STUB_PROVIDERS === ['"]1['"]/);
});
