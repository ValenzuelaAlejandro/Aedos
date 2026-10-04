const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/toolbar-events.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function bindEditorToolbarEvents', 'function bindEditorToolbarEvents') +
        '\nmodule.exports = { bindEditorToolbarEvents };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.bindEditorToolbarEvents;
}

test('toolbar events preserve size and text-color callback values', () => {
    const listeners = new Map();
    const calls = [];
    const ids = ['editor-btn-size-down', 'editor-btn-size-up', 'editor-btn-text-color'];
    const buttons = Object.fromEntries(ids.map(id => [id, { addEventListener: (_type, listener) => listeners.set(id, listener) }]));
    load()({
        document: { getElementById: id => buttons[id] || null },
        toolbar: { querySelectorAll: () => [] },
        window: { parent: null },
        CustomEvent() {},
        getSelectedElement: () => null,
        saveState() {},
        setActiveColorAction: value => calls.push(value),
        showColorPicker: value => calls.push(value),
        changeFontSize: value => calls.push(value),
        deleteElement() {}, duplicateElement() {}, isTextEditableElement: () => false,
    });
    const event = { stopPropagation() {}, currentTarget: 'anchor' };
    ids.forEach(id => listeners.get(id)(event));
    assert.deepEqual(calls, [-2, 2, 'text', 'anchor']);
});
