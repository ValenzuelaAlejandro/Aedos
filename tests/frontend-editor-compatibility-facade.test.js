const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFacade() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/compatibility-facade.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function installEditorCompatibilityFacade', 'function installEditorCompatibilityFacade') +
        '\nmodule.exports = { installEditorCompatibilityFacade };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.installEditorCompatibilityFacade;
}

function loadRuntimeBindings() {
    const module = { exports: {} };
    const context = {
        module,
        createEditorArrowMover: () => { context.calls.push('arrow'); return () => {}; },
        createEditorKeyboardHandler: () => { context.calls.push('keyboard'); return () => {}; },
        installEditorCompatibilityFacade: () => context.calls.push('facade'),
        calls: [],
    };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/runtime-bindings.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace(/^import .*;\r?\n/gm, '')
        .replace('export function installEditorRuntimeBindings', 'function installEditorRuntimeBindings') +
        '\nmodule.exports = { installEditorRuntimeBindings };';
    vm.runInContext(source, context, { filename: sourcePath });
    return { install: module.exports.installEditorRuntimeBindings, calls: context.calls };
}

function loadSelectionToolbarRuntime(events) {
    const module = { exports: {} };
    const context = {
        module,
        createEditorSelectionDom: () => {
            events.push('selection-dom');
            return {
                selectionBox: {},
                handleEls: {},
                toolbar: {},
                guideH: {},
                guideV: {},
                ensureUI: () => events.push('ensure-ui'),
            };
        },
        installEditorSlideObservers: () => events.push('slide-observers'),
        renderEditorToolbarMarkup: () => '<div></div>',
        createEditorFontSizeActions: () => {
            events.push('font-size-actions');
            return { changeFontSize() {}, updateSizeDisplay() {} };
        },
        bindEditorToolbarEvents: () => events.push('toolbar-bindings'),
        createEditorColorPicker: () => {
            events.push('color-picker');
            return { getDynamicPalette: () => [], showColorPicker() {} };
        },
    };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/selection-toolbar-runtime.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace(/^import .*;\r?\n/gm, '')
        .replace('export function createEditorSelectionToolbarRuntime', 'function createEditorSelectionToolbarRuntime') +
        '\nmodule.exports = { createEditorSelectionToolbarRuntime };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorSelectionToolbarRuntime;
}

test('selection toolbar runtime preserves DOM, observer, and listener setup order', () => {
    const events = [];
    const createRuntime = loadSelectionToolbarRuntime(events);
    const runtime = createRuntime({
        document: {},
        window: { dispatchEvent() {} },
        MutationObserver: function MutationObserver() {},
        pointerState: { selectedElement: null },
        saveState() {},
        isImageSlotElement() { return false; },
        isTextEditableElement() { return false; },
        replaceImage() {},
        deleteSelected() {},
        duplicateSelected() {},
        deselectGroup() {},
        CustomEvent: function CustomEvent() {},
    });
    assert.deepEqual(events, [
        'selection-dom',
        'ensure-ui',
        'slide-observers',
        'font-size-actions',
        'toolbar-bindings',
        'color-picker',
    ]);
    assert.equal(typeof runtime.getToolbarHTML, 'function');
    assert.equal(typeof runtime.updateSizeDisplay, 'function');
});

test('runtime bindings preserve save, keyboard, and compatibility registration order', () => {
    const runtime = loadRuntimeBindings();
    const document = { addEventListener: type => runtime.calls.push('listener:' + type) };
    runtime.install({
        document,
        window: {},
        CustomEvent: function CustomEvent() {},
        setTimeout: (_callback, delay) => runtime.calls.push('timer:' + delay),
        saveState: () => runtime.calls.push('save'),
        elementOperations: { duplicateElement: () => {} },
        getSelectedElement: () => null,
        getIsLocked: () => false,
        getIsJustSelected: () => false,
        getIsDragging: () => false,
        getIsResizing: () => false,
        undo: () => {},
        redo: () => {},
        deselectGroup: () => {},
        updateSelectionBox: () => {},
        collectGroup: () => [],
        getInheritedStyles: () => ({}),
        getStableDragTarget: () => null,
        normalizeElement: () => {},
        deleteElement: () => {},
        selectElement: () => {},
        resolveDragCollision: () => ({}),
    });
    assert.deepEqual(runtime.calls, [
        'timer:500',
        'arrow',
        'keyboard',
        'listener:keydown',
        'save',
        'facade',
    ]);
});

test('compatibility facade keeps selection, history, layer, and arrow window hooks', () => {
    const selected = { value: null };
    const calls = [];
    const child = { style: { position: 'absolute', zIndex: '1' } };
    const sibling = { style: { position: 'absolute', zIndex: '3' } };
    const parent = {
        children: [child, sibling],
        appendChild(element) { this.children = this.children.filter(item => item !== element); this.children.push(element); },
        prepend(element) { this.children = this.children.filter(item => item !== element); this.children.unshift(element); },
    };
    child.parentElement = parent;
    const window = { getComputedStyle: element => element.style };
    const installEditorCompatibilityFacade = loadFacade();
    installEditorCompatibilityFacade({
        window,
        getSelectedElement: () => selected.value,
        getIsJustSelected: () => true,
        getIsDragging: () => false,
        getIsResizing: () => true,
        undo: () => calls.push('undo'),
        redo: () => calls.push('redo'),
        saveState: () => calls.push('save'),
        deselect: () => calls.push('deselect'),
        updateSelection: () => calls.push('update'),
        selectElement: value => { selected.value = value; },
        duplicate: () => calls.push('duplicate'),
        deleteElement: () => calls.push('delete'),
        arrowMove: (key, shift) => calls.push(`${key}:${shift}`),
    });

    assert.equal(window.editorUndo instanceof Function, true);
    assert.equal(window.editorRedo instanceof Function, true);
    assert.equal(window.editorSaveState instanceof Function, true);
    assert.equal(window.editorDeselect instanceof Function, true);
    assert.equal(window.editorUpdateSelection instanceof Function, true);
    assert.equal(window.editorGetSelection(), null);
    assert.equal(window.isJustSelected(), true);
    assert.equal(window.editorIsDragging(), true);
    selected.value = child;
    window.toFront();
    assert.equal(child.style.zIndex, 4);
    window.toBack();
    assert.equal(parent.children[0], child);
    window.editorArrowMove('ArrowRight', true);
    assert.equal(calls.at(-1), 'ArrowRight:true');
});
