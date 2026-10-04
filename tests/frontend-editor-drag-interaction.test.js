const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDragInteraction() {
    const module = { exports: {} };
    const context = {
        module,
        resolveDragCollision: rect => ({ left: rect.left, top: rect.top }),
        findEditorSnapGuideMatch: loadSnapGuideMatch(),
    };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/drag-interaction.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace("import { resolveDragCollision } from './collision-geometry.js';", '')
        .replace("import { findEditorSnapGuideMatch } from './snap-guide-calculation.js';", '')
        .replace('export function applyEditorDrag', 'function applyEditorDrag') +
        '\nmodule.exports = { applyEditorDrag };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.applyEditorDrag;
}

function loadSnapGuideMatch() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/snap-guide-calculation.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function findEditorSnapGuideMatch', 'function findEditorSnapGuideMatch') +
        '\nmodule.exports = { findEditorSnapGuideMatch };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.findEditorSnapGuideMatch;
}

function loadPointerNormalization() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/pointer-normalization.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function normalizePointerTarget', 'function normalizePointerTarget') +
        '\nmodule.exports = { normalizePointerTarget };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.normalizePointerTarget;
}

test('drag interaction applies pointer delta, snap guides, and selection refresh', () => {
    const applyEditorDrag = loadDragInteraction();
    const calls = [];
    const currentElement = {
        _normalized: true,
        style: {},
        getBoundingClientRect: () => ({ width: 20, height: 10 }),
    };
    const guideH = { style: {} };
    const guideV = { style: {} };
    applyEditorDrag({ clientX: 20, clientY: 30 }, {
        currentElement, selectedElement: currentElement,
        slide: { getBoundingClientRect: () => ({ left: 100, top: 200 }) },
        startX: 10, startY: 20, startLeft: 40, startTop: 50,
        snapLinesX: [{ val: 50 }], snapLinesY: [{ val: 60 }], guideH, guideV,
        updateSelectionBox: () => calls.push('update'),
    });
    assert.equal(currentElement.style.left, '50px');
    assert.equal(currentElement.style.top, '60px');
    assert.equal(guideV.style.display, 'block');
    assert.equal(guideH.style.display, 'block');
    assert.deepEqual(calls, ['update']);
});

test('drag interaction ignores an unnormalized target', () => {
    const applyEditorDrag = loadDragInteraction();
    const currentElement = { style: {}, getBoundingClientRect: () => ({ width: 10, height: 10 }) };
    applyEditorDrag({ clientX: 50, clientY: 50 }, {
        currentElement, selectedElement: null, slide: null, startX: 0, startY: 0,
        startLeft: 0, startTop: 0, snapLinesX: [], snapLinesY: [],
        guideH: { style: {} }, guideV: { style: {} }, updateSelectionBox() {},
    });
    assert.deepEqual(currentElement.style, {});
});

test('pointer normalization preserves the three-pixel threshold and resets the drag origin', () => {
    const normalizePointerTarget = loadPointerNormalization();
    const element = {
        _normalized: false,
        style: { position: 'absolute', width: '40px', height: '', left: '12px', top: '18px' },
        getBoundingClientRect: () => ({ height: 24 }),
    };
    const state = {
        isDragging: true,
        activeDragTarget: element,
        selectedElement: element,
        startX: 10,
        startY: 20,
        startWidth: 0,
        startHeight: 0,
        startLeft: 0,
        startTop: 0,
    };
    const calls = [];
    const slide = {};
    const event = { clientX: 14, clientY: 20 };

    assert.equal(normalizePointerTarget(event, element, slide, state,
        (target, targetSlide) => {
            calls.push(['normalize', target, targetSlide]);
            target._normalized = true;
        },
        target => calls.push(['select', target]),
        () => calls.push(['update']),
    ), false);
    assert.deepEqual(calls, [['normalize', element, slide]]);
    assert.deepEqual([
        state.startWidth, state.startHeight, state.startLeft, state.startTop,
        state.startX, state.startY,
    ], [40, 24, 12, 18, 14, 20]);
});
