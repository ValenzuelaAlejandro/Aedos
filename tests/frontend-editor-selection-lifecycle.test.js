const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSelectionLifecycle() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/selection-lifecycle.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorSelectionLifecycle', 'function createEditorSelectionLifecycle') +
        '\nmodule.exports = { createEditorSelectionLifecycle };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorSelectionLifecycle;
}

function createLifecycleHarness() {
    const calls = [];
    const selected = { value: null };
    const selectionBox = { style: { display: 'block' } };
    const toolbar = { style: { display: 'flex' }, innerHTML: '' };
    const colorPicker = { style: { display: 'grid' } };
    class Observer {
        constructor(callback) { this.callback = callback; }
        observe(element, options) { calls.push(['observe', element, options]); }
        disconnect() { calls.push(['disconnect']); }
    }
    const slide = {};
    const element = {
        style: {},
        isContentEditable: false,
        closest: () => slide,
    };
    const window = {
        ResizeObserver: Observer,
        focus: () => calls.push(['focus']),
        getComputedStyle: () => ({ zIndex: '4' }),
        dispatchEvent: event => calls.push(['event', event.type, event.detail.element]),
    };
    const createEditorSelectionLifecycle = loadSelectionLifecycle();
    const lifecycle = createEditorSelectionLifecycle({
        document: { body: {}, getElementById: () => colorPicker },
        window,
        MutationObserver: Observer,
        ResizeObserver: Observer,
        CustomEvent: function CustomEvent(type, options) { this.type = type; this.detail = options.detail; },
        setTimeout: callback => { calls.push(['timer']); callback(); },
        getSelectedElement: () => selected.value,
        setSelectedElement: value => { selected.value = value; calls.push(['selection', value]); },
        getIsLocked: () => false,
        setJustSelected: value => calls.push(['just-selected', value]),
        freezeSlideLayout: value => calls.push(['freeze', value]),
        ensureUI: () => calls.push(['ensure-ui']),
        getToolbarHTML: () => '<div>toolbar</div>',
        bindToolbarEvents: () => calls.push(['bind-toolbar']),
        updateSelectionBox: () => calls.push(['update-box']),
        updateSizeDisplay: () => calls.push(['update-size']),
        selectionBox,
        toolbar,
    });
    return { calls, selected, selectionBox, toolbar, colorPicker, slide, element, lifecycle };
}

test('selection retains UI setup, observer options, and selection notification order', () => {
    const harness = createLifecycleHarness();
    harness.lifecycle.selectElement(harness.element);

    assert.equal(harness.selected.value, harness.element);
    assert.equal(harness.toolbar.innerHTML, '<div>toolbar</div>');
    assert.equal(harness.colorPicker.style.display, 'none');
    assert.deepEqual(harness.calls.slice(0, 7).map(call => call[0]), [
        'freeze', 'focus', 'selection', 'ensure-ui', 'bind-toolbar', 'update-box', 'update-size',
    ]);
    const observerOptions = harness.calls.find(call => call[0] === 'observe')[2];
    assert.equal(observerOptions.attributes, true);
    assert.deepEqual([...observerOptions.attributeFilter], ['style', 'class']);
    assert.equal(observerOptions.characterData, true);
    assert.equal(observerOptions.subtree, true);
    assert.equal(harness.calls.some(call => call[0] === 'event' && call[1] === 'selection-changed'), true);
});

test('deselect disconnects observers, clears controls, and preserves silent mode', () => {
    const harness = createLifecycleHarness();
    harness.lifecycle.selectElement(harness.element);
    harness.calls.length = 0;
    harness.lifecycle.deselectGroup(true);

    assert.equal(harness.selected.value, null);
    assert.equal(harness.selectionBox.style.display, 'none');
    assert.equal(harness.toolbar.style.display, 'none');
    assert.equal(harness.colorPicker.style.display, 'none');
    assert.equal(harness.calls.filter(call => call[0] === 'disconnect').length, 2);
    assert.equal(harness.calls.some(call => call[0] === 'event'), false);
});
