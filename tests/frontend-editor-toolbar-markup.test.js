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

function loadToolbarSizeEvents() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/toolbar-size-events.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function bindEditorToolbarSizeEvents', 'function bindEditorToolbarSizeEvents') +
        '\nmodule.exports = { bindEditorToolbarSizeEvents };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.bindEditorToolbarSizeEvents;
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

test('toolbar size events keep their selectors, delta and propagation order', () => {
    const bind = loadToolbarSizeEvents();
    const calls = [];
    const buttons = new Map();
    for (const id of ['editor-btn-size-down', 'editor-btn-size-up']) {
        buttons.set(id, { addEventListener: (type, listener) => calls.push({ id, type, listener }) });
    }
    bind({ document: { getElementById: id => buttons.get(id) }, changeFontSize: delta => calls.push({ delta }) });
    assert.deepEqual(calls.map(({ id, type }) => [id, type]), [
        ['editor-btn-size-down', 'click'],
        ['editor-btn-size-up', 'click'],
    ]);
    let stopped = 0;
    calls[0].listener({ stopPropagation: () => { stopped += 1; } });
    calls[1].listener({ stopPropagation: () => { stopped += 1; } });
    assert.deepEqual(calls.slice(2).map(({ delta }) => delta), [-2, 2]);
    assert.equal(stopped, 2);
});
