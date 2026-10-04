const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadToolbarMarkup() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/toolbar-markup.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function renderEditorToolbarMarkup', 'function renderEditorToolbarMarkup') +
        '\nmodule.exports = { renderEditorToolbarMarkup };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.renderEditorToolbarMarkup;
}

test('toolbar markup retains text controls and shared actions', () => {
    const render = loadToolbarMarkup();
    const html = render({
        window: { parent: { __t: (_key, fallback) => fallback } },
        selectedElement: { matches: () => false },
        palette: ['red', 'blue'],
        isImageSlotElement: () => false,
        isTextEditableElement: () => true,
    });
    assert.match(html, /editor-btn-size-down/);
    assert.match(html, /editor-btn-text-color/);
    assert.match(html, /editor-btn-duplicate/);
    assert.match(html, /editor-btn-delete/);
    assert.equal((html.match(/class="editor-color-swatch"/g) || []).length, 2);
});

test('toolbar markup retains image replacement and shape fill branches', () => {
    const render = loadToolbarMarkup();
    const options = {
        window: { parent: { __t: (_key, fallback) => fallback } },
        selectedElement: { matches: () => false },
        palette: [],
        isImageSlotElement: element => element.isImage,
        isTextEditableElement: () => false,
    };
    assert.match(render({ ...options, selectedElement: { matches: () => true } }), /editor-btn-replace-img/);
    assert.match(render(options), /editor-btn-bg-color/);
    assert.equal(render({ ...options, selectedElement: null }), '');
});
