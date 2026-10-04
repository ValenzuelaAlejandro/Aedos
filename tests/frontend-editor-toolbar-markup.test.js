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
        .replace('export function renderEditorToolbarMarkup', 'function renderEditorToolbarMarkup')
        .replace('export function bindEditorToolbarEvents', 'function bindEditorToolbarEvents') +
        '\nmodule.exports = { renderEditorToolbarMarkup, bindEditorToolbarEvents };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports;
}

test('toolbar markup retains text controls and shared actions', () => {
    const { renderEditorToolbarMarkup: render } = loadToolbarMarkup();
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
    const { renderEditorToolbarMarkup: render } = loadToolbarMarkup();
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

test('toolbar events preserve size, color, delete, duplicate, and swatch callbacks', () => {
    const { bindEditorToolbarEvents } = loadToolbarMarkup();
    const calls = [];
    const handlers = {};
    const makeButton = id => ({ addEventListener: (name, callback) => { handlers[id] = callback; } });
    const buttons = Object.fromEntries([
        'editor-btn-size-down', 'editor-btn-size-up', 'editor-btn-text-color',
        'editor-btn-bg-color', 'editor-btn-delete', 'editor-btn-duplicate',
    ].map(id => [id, makeButton(id)]));
    const swatch = {
        dataset: { color: 'tomato' },
        addEventListener: (name, callback) => { handlers.swatch = callback; },
    };
    const selected = {
        style: {},
        matches: () => false,
        tagName: 'DIV',
        querySelector: () => null,
    };
    bindEditorToolbarEvents({
        document: { getElementById: id => buttons[id] || null },
        window: { dispatchEvent: event => calls.push(event.type) },
        CustomEvent: function CustomEvent(type) { this.type = type; },
        toolbar: { querySelectorAll: () => [swatch] },
        getSelectedElement: () => selected,
        setActiveColorAction: action => calls.push(`color:${action}`),
        changeFontSize: delta => calls.push(`size:${delta}`),
        showColorPicker: () => calls.push('picker'),
        deleteElement: element => calls.push(element === selected ? 'delete' : 'delete:none'),
        duplicateElement: element => calls.push(element === selected ? 'duplicate' : 'duplicate:none'),
        saveState: () => calls.push('save'),
        isTextEditableElement: () => false,
    });
    const click = callback => callback({ stopPropagation() {}, currentTarget: {} });
    click(handlers['editor-btn-size-down']);
    click(handlers['editor-btn-size-up']);
    click(handlers['editor-btn-text-color']);
    click(handlers['editor-btn-bg-color']);
    click(handlers['editor-btn-delete']);
    click(handlers['editor-btn-duplicate']);
    click(handlers.swatch);
    assert.deepEqual(calls, [
        'size:-2', 'size:2', 'color:text', 'picker', 'color:bg', 'picker',
        'delete', 'duplicate', 'save', 'selection-changed',
    ]);
    assert.equal(selected.style.backgroundColor, 'tomato');
});
