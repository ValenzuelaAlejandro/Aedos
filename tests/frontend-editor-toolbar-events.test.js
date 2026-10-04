const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBinder() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/toolbar-events.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorToolbarEventBinder', 'function createEditorToolbarEventBinder') +
        '\nmodule.exports = { createEditorToolbarEventBinder };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorToolbarEventBinder;
}

test('toolbar event binder preserves button order, callbacks, propagation guards, and quick-color updates', () => {
    const calls = [];
    const buttonsHandlers = {};
    const ids = [
        'editor-btn-size-down', 'editor-btn-size-up', 'editor-btn-text-color', 'editor-btn-bg-color',
        'editor-btn-replace-img', 'editor-btn-delete', 'editor-btn-duplicate',
    ];
    const buttons = Object.fromEntries(ids.map(id => [id, {
        addEventListener: (type, handler) => { calls.push(['bind', id, type]); buttonsHandlers[id] = handler; },
    }]));
    const selected = { style: {}, matches: () => true, tagName: 'DIV', querySelector: () => null };
    const swatch = {
        dataset: { color: '#123456' },
        addEventListener: (type, handler) => { calls.push(['bind', 'swatch', type]); buttonsHandlers.swatch = handler; },
    };
    const toolbar = { querySelectorAll: () => [swatch] };
    let action;
    loadBinder()({
        document: { getElementById: id => buttons[id] },
        window: { parent: {}, dispatchEvent: event => calls.push(['dispatch', event.type]) },
        CustomEvent: function CustomEvent(type) { this.type = type; },
        toolbar,
        getSelectedElement: () => selected,
        setActiveColorAction: value => { action = value; },
        changeFontSize: delta => calls.push(['size', delta]),
        showColorPicker: anchor => calls.push(['picker', anchor]),
        deleteElement: element => calls.push(['delete', element]),
        duplicateElement: element => calls.push(['duplicate', element]),
        saveState: () => calls.push(['save']),
        isTextEditableElement: () => false,
    })();

    assert.deepEqual(calls.filter(call => call[0] === 'bind').map(call => call[1]), [...ids, 'swatch']);
    const event = { stopped: false, stopPropagation() { this.stopped = true; }, currentTarget: buttons['editor-btn-text-color'] };
    buttonsHandlers['editor-btn-text-color'](event);
    buttonsHandlers['editor-btn-size-up'](event);
    buttonsHandlers.swatch(event);

    assert.equal(action, 'text');
    assert.equal(event.stopped, true);
    assert.equal(selected.style.color, '#123456');
    assert.equal(selected.style.webkitTextFillColor, '#123456');
    assert.ok(calls.some(call => call[0] === 'picker'));
    assert.ok(calls.some(call => call[0] === 'size' && call[1] === 2));
    assert.ok(calls.some(call => call[0] === 'save'));
    assert.ok(calls.some(call => call[0] === 'dispatch' && call[1] === 'selection-changed'));
});
