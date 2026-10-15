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
        .map((tag) => tag.match(/\bhref="([^"]+)"/)?.[1]?.split('?')[0])
        .filter(Boolean);
    const expected = [
        'styles/foundation.css',
        'styles/chat.css',
        'styles/settings.css',
        'styles/dialogs.css',
        'styles/preview.css',
        'styles/workspace.css',
    ];
    const start = stylesheetHrefs.indexOf(expected[0]);

    assert.notEqual(start, -1, 'foundation sheet is linked');
    assert.deepEqual(stylesheetHrefs.slice(start, start + expected.length), expected);
    assert.ok(!stylesheetHrefs.some((href) => href.startsWith('styles/style.css')));
});
