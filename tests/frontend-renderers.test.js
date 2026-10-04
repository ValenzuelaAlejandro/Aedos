const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'src/frontend/features/chat/attachment-renderer.js');
const fixturePath = path.join(root, 'tests/fixtures/frontend/renderers/attachment-chip-cases.json');
const contentUtilsPath = path.join(root, 'src/frontend/features/shared/content-utils.js');

function loadRenderer() {
    const window = {};
    vm.runInNewContext(fs.readFileSync(rendererPath, 'utf8'), { window }, { filename: rendererPath });
    return window;
}

test('chat attachment chips remain byte-identical to the legacy renderer cases', () => {
    const window = loadRenderer();
    const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    for (const vector of cases) {
        const html = window.AedosChatRenderer.renderFileChip(vector.file);
        assert.equal(html.length, vector.length, vector.file.name);
        assert.equal(crypto.createHash('sha256').update(html).digest('hex'), vector.sha256, vector.file.name);
    }
});

test('shared escaping keeps the classic global and exact entity mapping', () => {
    const window = loadRenderer();
    assert.equal(window.escapeHtml('<tag & "quote" \'single\'>'), '&lt;tag &amp; &quot;quote&quot; &#039;single&#039;&gt;');
    assert.equal(window.escapeHtml(42), '');
    assert.equal(window.escapeHtml(null), '');
});

test('content utilities preserve sanitization output and GIF compatibility globals', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync(contentUtilsPath, 'utf8'), {
        window,
        FileReader: function FileReader() {},
        URL: {},
        Image: function Image() {},
        document: {},
    }, { filename: contentUtilsPath });
    const input = '<div onclick="x()"><script>alert(1)</script><link href="x">ok</div>';
    assert.equal(window.AedosContentUtils.sanitizeModelOutput(input), '<div>ok</div>');
    assert.equal(window.sanitizeModelOutput, window.AedosContentUtils.sanitizeModelOutput);
    assert.equal(window.gifToStaticDataUrl, window.AedosContentUtils.gifToStaticDataUrl);
    assert.equal(window.AedosContentUtils.sanitizeModelOutput(null), null);
});
