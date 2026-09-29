const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'sanitization-stub';
const { sanitizeGeneratedHtml } = require('../../src/backend/server');
const fixtureDir = path.join(__dirname, '..', 'fixtures', 'sanitization');

for (const name of fs.readdirSync(fixtureDir).filter((file) => file.endsWith('.input.html')).map((file) => file.replace('.input.html', ''))) {
    test(`sanitization snapshot: ${name}`, () => {
        const input = fs.readFileSync(path.join(fixtureDir, `${name}.input.html`), 'utf8');
        const expected = fs.readFileSync(path.join(fixtureDir, `${name}.output.html`), 'utf8');
        assert.equal(sanitizeGeneratedHtml(input), expected);
        const hashFile = path.join(fixtureDir, `${name}.sha256`);
        if (fs.existsSync(hashFile)) {
            const actualHash = crypto.createHash('sha256').update(sanitizeGeneratedHtml(input)).digest('hex');
            assert.equal(actualHash, fs.readFileSync(hashFile, 'utf8').trim());
        }
    });
}
