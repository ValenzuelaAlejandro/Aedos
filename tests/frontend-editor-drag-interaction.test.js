const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDragInteraction() {
    const module = { exports: {} };
    const context = { module, resolveDragCollision: rect => ({ left: rect.left, top: rect.top }) };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/drag-interaction.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace("import { resolveDragCollision } from './collision-geometry.js';", '')
        .replace('export function applyEditorDrag', 'function applyEditorDrag') +
        '\nmodule.exports = { applyEditorDrag };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.applyEditorDrag;
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
