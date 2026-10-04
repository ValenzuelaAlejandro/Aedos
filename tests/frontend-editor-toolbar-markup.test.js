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

function loadToolbarActionEvents() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/toolbar-action-events.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function bindEditorToolbarActionEvents', 'function bindEditorToolbarActionEvents') +
        '\nmodule.exports = { bindEditorToolbarActionEvents };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.bindEditorToolbarActionEvents;
}

function loadToolbarSwatchEvents() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/toolbar-swatch-events.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function bindEditorToolbarSwatchEvents', 'function bindEditorToolbarSwatchEvents') +
        '\nmodule.exports = { bindEditorToolbarSwatchEvents };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.bindEditorToolbarSwatchEvents;
}

function loadMouseupCleanup() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/mouseup-cleanup.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function registerEditorMouseupCleanup', 'function registerEditorMouseupCleanup') +
        '\nmodule.exports = { registerEditorMouseupCleanup };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.registerEditorMouseupCleanup;
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

test('toolbar action events retain selector order, callbacks and propagation', () => {
    const bind = loadToolbarActionEvents();
    const calls = [];
    const ids = ['editor-btn-text-color', 'editor-btn-bg-color', 'editor-btn-replace-img', 'editor-btn-delete', 'editor-btn-duplicate'];
    const buttons = new Map(ids.map(id => [id, { addEventListener: (type, listener) => calls.push({ id, type, listener }) }]));
    const selected = {};
    bind({
        document: { getElementById: id => buttons.get(id) },
        window: { parent: { _triggerImagePicker: true } },
        getSelectedElement: () => selected,
        showColorPicker: (action, anchor) => calls.push({ action, anchor }),
        replaceImage: element => calls.push({ replace: element }),
        deleteSelected: () => calls.push({ deleted: true }),
        duplicateSelected: () => calls.push({ duplicated: true }),
    });
    assert.deepEqual(calls.slice(0, 5).map(({ id, type }) => [id, type]), ids.map(id => [id, 'click']));
    const stopped = [];
    for (const { listener } of calls.slice(0, 5)) listener({ stopPropagation: () => stopped.push(true), currentTarget: {} });
    assert.deepEqual(calls.slice(5).map(call => Object.keys(call)[0]), ['action', 'action', 'replace', 'deleted', 'duplicated']);
    assert.deepEqual(calls.slice(5, 7).map(({ action }) => action), ['text', 'bg']);
    assert.equal(calls[7].replace, selected);
    assert.equal(stopped.length, 5);
});

test('toolbar swatches preserve text and fill updates and selection notification', () => {
    const bind = loadToolbarSwatchEvents();
    const calls = [];
    const listeners = [];
    const toolbar = { querySelectorAll: selector => {
        calls.push(selector);
        return [{ dataset: { color: '#123456' }, addEventListener: (type, listener) => listeners.push({ type, listener }) }];
    } };
    const text = {
        style: {},
        matches: () => false,
        tagName: 'P',
        querySelector: () => null,
    };
    bind({
        toolbar,
        getSelectedElement: () => text,
        saveState: () => calls.push('save'),
        isTextEditableElement: () => true,
        dispatchSelectionChanged: element => calls.push(element),
    });
    assert.deepEqual(calls, ['.editor-color-swatches-mini .editor-color-swatch']);
    assert.equal(listeners[0].type, 'click');
    let stopped = false;
    listeners[0].listener({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(text.style.color, '#123456');
    assert.equal(text.style.webkitTextFillColor, '#123456');
    assert.equal(calls[1], 'save');
    assert.equal(calls[2], text);
});

test('mouseup cleanup preserves reset, guide, selection and per-mousedown order', () => {
    const register = loadMouseupCleanup();
    const calls = [];
    const selected = { _normalized: true };
    const editable = { _stateSavedSinceMousedown: true };
    let listener;
    register({
        document: { addEventListener: (type, callback) => { calls.push(['listen', type]); listener = callback; } },
        setDragging: value => calls.push(['dragging', value]),
        setResizing: value => calls.push(['resizing', value]),
        setCurrentHandle: value => calls.push(['handle', value]),
        clearDragGroup: () => calls.push(['group']),
        setActiveDragTarget: value => calls.push(['target', value]),
        guideH: { style: { set display(value) { calls.push(['guideH', value]); } } },
        guideV: { style: { set display(value) { calls.push(['guideV', value]); } } },
        getSelectedElement: () => selected,
        updateSelectionBox: () => calls.push(['selection']),
        getAllEditables: () => { calls.push(['editables']); return [editable]; },
    });
    listener();
    assert.deepEqual(calls, [
        ['listen', 'mouseup'], ['dragging', false], ['resizing', false], ['handle', null],
        ['group'], ['target', null], ['guideH', 'none'], ['guideV', 'none'],
        ['selection'], ['editables'],
    ]);
    assert.equal('_normalized' in selected, false);
    assert.equal('_stateSavedSinceMousedown' in editable, false);
});
