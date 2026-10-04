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

test('toolbar controls preserve size, color-action, and delete callback behavior', () => {
    const calls = [];
    const listeners = new Map();
    const ids = ['editor-btn-size-down', 'editor-btn-size-up', 'editor-btn-text-color', 'editor-btn-bg-color', 'editor-btn-delete'];
    const buttons = Object.fromEntries(ids.map(id => [id, {
        addEventListener: (type, listener) => listeners.set(id, listener),
    }]));
    const selected = {};
    const bindEditorToolbarEvents = loadToolbarEvents();
    bindEditorToolbarEvents({
        document: { getElementById: id => buttons[id] || null },
        toolbar: { querySelectorAll: () => [] },
        window: { parent: null, dispatchEvent: () => {} },
        CustomEvent: function CustomEvent() {},
        getSelectedElement: () => selected,
        saveState: () => calls.push('save'),
        setActiveColorAction: action => calls.push(action),
        showColorPicker: anchor => calls.push(anchor),
        changeFontSize: delta => calls.push(delta),
        deleteElement: element => calls.push(element),
        duplicateElement: () => {},
        isTextEditableElement: () => false,
    });
    const event = { stopPropagation() {}, currentTarget: 'anchor' };

    listeners.get('editor-btn-size-down')(event);
    listeners.get('editor-btn-size-up')(event);
    listeners.get('editor-btn-text-color')(event);
    listeners.get('editor-btn-bg-color')(event);
    listeners.get('editor-btn-delete')(event);
    assert.deepEqual(calls, [-2, 2, 'text', 'anchor', 'bg', 'anchor', selected]);
});
