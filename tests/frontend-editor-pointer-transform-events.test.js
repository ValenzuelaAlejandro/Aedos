const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadInstaller() {
    const module = { exports: {} };
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/pointer-transform-events.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function installEditorPointerTransformEvents', 'function installEditorPointerTransformEvents') +
        '\nmodule.exports = { installEditorPointerTransformEvents };';
    vm.runInNewContext(source, { module, Math, parseFloat, isNaN, Object });
    return module.exports.installEditorPointerTransformEvents;
}

function setup(initialState, overrides = {}) {
    let listener;
    let state = { ...initialState };
    const updates = [];
    const applied = [];
    const install = loadInstaller();
    install({
        document: { body: {}, addEventListener: (name, callback) => { if (name === 'mousemove') listener = callback; } },
        getState: () => state,
        updateState: patch => { updates.push(patch); state = { ...state, ...patch }; },
        normalizeElement: overrides.normalizeElement || (() => {}),
        selectElement() {}, updateSelectionBox() {},
        applyEditorDrag: (event, dragState) => applied.push({ mode: 'drag', event, state: dragState }),
        applyEditorResize: (event, resizeState) => applied.push({ mode: 'resize', event, state: resizeState }),
        guideH: {}, guideV: {},
    });
    return { listener, updates, applied, getState: () => state };
}

test('pointer transform listener resets drag anchors after normalization before applying movement', () => {
    const element = {
        _normalized: false,
        style: { position: 'absolute', width: '40px', height: '', left: '12px', top: '18px' },
        closest: () => ({}),
        getBoundingClientRect: () => ({ height: 25 }),
    };
    const rig = setup({
        selectedElement: element, activeDragTarget: null, isDragging: true, isResizing: false,
        startX: 0, startY: 0, startLeft: 3, startTop: 4, startWidth: 0, startHeight: 0,
        currentHandle: null, snapLinesX: [], snapLinesY: [],
    }, { normalizeElement: target => { target._normalized = true; } });
    rig.listener({ clientX: 10, clientY: 11 });
    assert.equal(rig.updates.length, 1);
    assert.deepEqual({ ...rig.updates[0] }, {
        startWidth: 40, startHeight: 25, startLeft: 12, startTop: 18, startX: 10, startY: 11,
    });
    assert.equal(rig.applied[0].mode, 'drag');
    assert.equal(rig.applied[0].state.startX, 10);
    assert.equal(rig.applied[0].state.startTop, 18);
});

test('pointer transform listener aborts an unpositioned target after normalization', () => {
    const element = {
        _normalized: false, style: { position: 'relative' }, closest: () => ({}),
    };
    const rig = setup({
        selectedElement: element, activeDragTarget: null, isDragging: true, isResizing: false,
        startX: 0, startY: 0, snapLinesX: [], snapLinesY: [],
    });
    rig.listener({ clientX: 4, clientY: 0 });
    assert.deepEqual({ ...rig.updates[0] }, { isDragging: false, activeDragTarget: null });
    assert.equal(rig.applied.length, 0);
});

test('pointer transform listener does nothing without a selected or dragged element', () => {
    const rig = setup({ selectedElement: null, activeDragTarget: null, isDragging: false, isResizing: false });
    rig.listener({ clientX: 4, clientY: 5 });
    assert.equal(rig.applied.length, 0);
    assert.equal(rig.updates.length, 0);
});
