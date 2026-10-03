const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const indexPath = path.join(__dirname, '..', 'src/frontend/index.html');

test('main style sheets preserve their source cascade order as a contiguous group', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    const stylesheetHrefs = [...html.matchAll(/<link\b[^>]*>/g)]
        .map(([tag]) => tag)
        .filter((tag) => /\brel="stylesheet"/.test(tag))
        .map((tag) => tag.match(/\bhref="([^"]+)"/)?.[1])
        .filter(Boolean);
    const expected = [
        'styles/foundation.css?v=1',
        'styles/chat.css?v=1',
        'styles/settings.css?v=1',
        'styles/dialogs.css?v=1',
        'styles/preview.css?v=1',
        'styles/workspace.css?v=1',
    ];
    const start = stylesheetHrefs.indexOf(expected[0]);

    assert.notEqual(start, -1, 'foundation sheet is linked');
    assert.deepEqual(stylesheetHrefs.slice(start, start + expected.length), expected);
    assert.ok(!stylesheetHrefs.some((href) => href.startsWith('styles/style.css')));
});
