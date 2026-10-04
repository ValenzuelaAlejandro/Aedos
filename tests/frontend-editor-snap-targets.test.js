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
