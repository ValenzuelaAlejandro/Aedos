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
        .replace('export function createEditorToolbarEvents', 'function createEditorToolbarEvents') +
        '\nmodule.exports = { createEditorToolbarEvents };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorToolbarEvents;
}

function createButton() {
    const handlers = {};
    return {
        handlers,
        addEventListener: (type, handler) => { handlers[type] = handler; },
    };
}

test('toolbar button bindings preserve size delta, action selection, and picker target', () => {
    const sizeDown = createButton();
    const textColor = createButton();
    const buttons = new Map([
        ['editor-btn-size-down', sizeDown],
        ['editor-btn-text-color', textColor],
    ]);
    const actions = [];
    const sizes = [];
    const anchors = [];
    const createEditorToolbarEvents = loadToolbarEvents();
    const bind = createEditorToolbarEvents({
        document: { getElementById: id => buttons.get(id) || null },
        toolbar: { querySelectorAll: () => [] },
        window: { parent: {}, dispatchEvent: () => {} },
        CustomEvent: function CustomEvent() {},
        getSelectedElement: () => null,
        setActiveColorAction: action => actions.push(action),
        changeFontSize: delta => sizes.push(delta),
        showColorPicker: anchor => anchors.push(anchor),
        deleteElement: () => {},
        duplicateElement: () => {},
        saveState: () => {},
        isTextEditableElement: () => false,
    });

    bind();
    sizeDown.handlers.click({ stopPropagation() {} });
    const anchor = {};
    textColor.handlers.click({ stopPropagation() {}, currentTarget: anchor });

    assert.deepEqual(sizes, [-2]);
    assert.deepEqual(actions, ['text']);
    assert.equal(anchors[0], anchor);
});

test('quick swatch changes text color and emits selection-changed', () => {
    const swatch = createButton();
    swatch.dataset = { color: '#123456' };
    const selectedElement = {
        style: {},
        tagName: 'p',
        matches: () => false,
    };
    const dispatched = [];
    const createEditorToolbarEvents = loadToolbarEvents();
    const bind = createEditorToolbarEvents({
        document: { getElementById: () => null },
        toolbar: { querySelectorAll: () => [swatch] },
        window: { parent: {}, dispatchEvent: event => dispatched.push(event.type) },
        CustomEvent: function CustomEvent(type) { this.type = type; },
        getSelectedElement: () => selectedElement,
        setActiveColorAction: () => {},
        changeFontSize: () => {},
        showColorPicker: () => {},
        deleteElement: () => {},
        duplicateElement: () => {},
        saveState: () => {},
        isTextEditableElement: () => true,
    });

    bind();
    swatch.handlers.click({ stopPropagation() {} });

    assert.equal(selectedElement.style.color, '#123456');
    assert.equal(selectedElement.style.webkitTextFillColor, '#123456');
    assert.deepEqual(dispatched, ['selection-changed']);
});
