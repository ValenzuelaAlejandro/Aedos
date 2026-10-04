const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadToolbarEvents() {
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

test('toolbar event binding preserves size, color, and delete callbacks', () => {
    const calls = [];
    const listeners = new Map();
    const ids = ['editor-btn-size-down', 'editor-btn-size-up', 'editor-btn-text-color', 'editor-btn-bg-color', 'editor-btn-delete'];
    const buttons = Object.fromEntries(ids.map(id => [id, { addEventListener: (_type, listener) => listeners.set(id, listener) }]));
    const selectedElement = {};
    loadToolbarEvents()({
        document: { getElementById: id => buttons[id] || null },
        toolbar: { querySelectorAll: () => [] },
        window: { parent: null, dispatchEvent() {} },
        CustomEvent: function CustomEvent() {},
        getSelectedElement: () => selectedElement,
        saveState() {},
        setActiveColorAction: action => calls.push(action),
        showColorPicker: anchor => calls.push(anchor),
        changeFontSize: delta => calls.push(delta),
        deleteElement: element => calls.push(element),
        duplicateElement() {},
        isTextEditableElement: () => false,
    });
    const event = { stopPropagation() {}, currentTarget: 'anchor' };
    ['editor-btn-size-down', 'editor-btn-size-up', 'editor-btn-text-color', 'editor-btn-bg-color', 'editor-btn-delete']
        .forEach(id => listeners.get(id)(event));
    assert.deepEqual(calls, [-2, 2, 'text', 'anchor', 'bg', 'anchor', selectedElement]);
});
