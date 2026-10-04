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
        .replace('export function createEditorToolbarMarkup', 'function createEditorToolbarMarkup') +
        '\nmodule.exports = { createEditorToolbarMarkup };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorToolbarMarkup;
}

function createMarkup(element, options = {}) {
    const createEditorToolbarMarkup = loadToolbarMarkup();
    return createEditorToolbarMarkup({
        getSelectedElement: () => element,
        getDynamicPalette: () => ['#123456', '#abcdef', '#010203', '#040506', '#070809'],
        isImageSlotElement: () => Boolean(options.imageSlot),
        isTextEditableElement: () => Boolean(options.text),
        translate: (key, fallback) => `${key}:${fallback}`,
    });
}

test('no current selection produces no toolbar markup', () => {
    assert.equal(createMarkup(null)(), '');
});

test('text toolbar retains its color, size, duplicate, and delete controls', () => {
    const html = createMarkup({ matches: () => false }, { text: true })();

    assert.match(html, /editor-btn-size-down/);
    assert.match(html, /editor-btn-size-up/);
    assert.match(html, /editor-btn-text-color/);
    assert.match(html, /editor-btn-duplicate/);
    assert.match(html, /editor-btn-delete/);
    assert.equal((html.match(/class="editor-color-swatch"/g) || []).length, 4);
});

test('image and visual targets retain their distinct controls', () => {
    const element = { matches: selector => selector === 'img' };
    const imageHtml = createMarkup(element)();
    const shapeHtml = createMarkup({ matches: () => false })();

    assert.match(imageHtml, /editor-btn-replace-img/);
    assert.doesNotMatch(imageHtml, /editor-btn-bg-color/);
    assert.match(shapeHtml, /editor-btn-bg-color/);
    assert.match(shapeHtml, /editor-color-picker/);
});
