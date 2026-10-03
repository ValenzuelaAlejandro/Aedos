const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'sanitization-stub';
const { sanitizeGeneratedHtml } = require('../../src/backend/server');
const fixtureDir = path.join(__dirname, '..', 'fixtures', 'sanitization');

for (const name of fs
    .readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.input.html'))
    .map((file) => file.replace('.input.html', ''))) {
    test(`sanitization snapshot: ${name}`, () => {
        const input = fs.readFileSync(path.join(fixtureDir, `${name}.input.html`), 'utf8');
        const expected = fs.readFileSync(path.join(fixtureDir, `${name}.output.html`), 'utf8');
        assert.equal(sanitizeGeneratedHtml(input), expected);
        const hashFile = path.join(fixtureDir, `${name}.sha256`);
        if (fs.existsSync(hashFile)) {
            const actualHash = crypto
                .createHash('sha256')
                .update(sanitizeGeneratedHtml(input))
                .digest('hex');
            assert.equal(actualHash, fs.readFileSync(hashFile, 'utf8').trim());
        }
    });
}

test('removes the specifically listed embedded and CSS execution vectors', () => {
    const inputs = [
        '<iframe src="https://evil.test">fallback</iframe><object data="x">fallback</object><embed src="x">',
        '<style>@import url(https://evil.test/x.css); .x{background:url(javascript:bad);color:red}</style>',
        '<a href=javascript:alert(1)>link</a><img src="data:text/html,<script>bad</script>">',
        '<div style="background:url(javascript:bad);background-image:url(data:text/html,bad);color:red;behavior:url(x);width:expression(alert(1))">safe</div>',
    ];
    for (const input of inputs) {
        const output = sanitizeGeneratedHtml(input);
        assert.doesNotMatch(output, /<(?:iframe|object|embed)\b/i);
        assert.doesNotMatch(output, /@import/i);
        assert.doesNotMatch(output, /url\(\s*["']?\s*javascript:/i);
        assert.doesNotMatch(output, /\bjavascript:/i);
        assert.doesNotMatch(output, /data:text\/html/i);
        assert.doesNotMatch(output, /\bexpression\s*\(/i);
        assert.doesNotMatch(output, /\bbehavior\s*:/i);
    }
});
