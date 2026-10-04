const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSnapTargets() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/snap-targets.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorSnapTargets', 'function createEditorSnapTargets') +
        '\nmodule.exports = { createEditorSnapTargets };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorSnapTargets;
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

test('snap targets preserve slide guides, padding, and peer edge order', () => {
    const createEditorSnapTargets = loadSnapTargets();
    const active = { classList: { contains: () => false } };
    const peer = {
        classList: { contains: () => false },
        getBoundingClientRect: () => ({ left: 150, top: 260, width: 40, height: 20 }),
    };
    const slide = { getBoundingClientRect: () => ({ left: 100, top: 200, width: 400, height: 300 }) };

    const targets = createEditorSnapTargets(slide, active, () => [active, peer]);
    assert.deepEqual(Array.from(targets.snapLinesX, item => item.val), [200, 0, 400, 40, 360, 50, 70, 90]);
    assert.deepEqual(Array.from(targets.snapLinesY, item => item.val), [150, 0, 300, 40, 260, 60, 70, 80]);
});

test('snap targets are empty when there is no slide', () => {
    const createEditorSnapTargets = loadSnapTargets();
    const targets = createEditorSnapTargets(null, null, () => []);
    assert.deepEqual(Array.from(targets.snapLinesX), []);
    assert.deepEqual(Array.from(targets.snapLinesY), []);
});

test('snap guide calculation keeps closest-target order, strict tolerance, and delta', () => {
    const findEditorSnapGuideMatch = loadSnapGuideMatch();
    const match = findEditorSnapGuideMatch([40, 45], [{ val: 47 }, { val: 42 }], 8);
    assert.deepEqual({ ...match }, { value: 42, delta: 2 });
    assert.deepEqual({ ...findEditorSnapGuideMatch([40], [{ val: 48 }], 8) }, { value: null, delta: 0 });
});

test('snap guide calculation keeps the first target on an equal-distance tie', () => {
    const findEditorSnapGuideMatch = loadSnapGuideMatch();
    assert.deepEqual({ ...findEditorSnapGuideMatch([10], [{ val: 9 }, { val: 11 }], 8) }, { value: 9, delta: -1 });
});
