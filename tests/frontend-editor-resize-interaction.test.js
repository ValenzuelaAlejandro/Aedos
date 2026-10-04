const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadResizeInteraction() {
    const module = { exports: {} };
    const context = {
        module,
        resolveResizeCollision: (rect, _handle, _slide, _selected, fixed) => ({
            ...rect,
            width: Math.max(20, rect.width),
            height: Math.max(20, rect.height),
            left: rect.width < 20 && fixed.fixedRight !== undefined ? fixed.fixedRight - 20 : rect.left,
            top: rect.height < 20 && fixed.fixedBottom !== undefined ? fixed.fixedBottom - 20 : rect.top,
        }),
    };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/resize-interaction.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace("import { resolveResizeCollision } from './collision-geometry.js';", '')
        .replace('export function applyEditorResize', 'function applyEditorResize') +
        '\nmodule.exports = { applyEditorResize };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.applyEditorResize;
}

test('resize interaction applies pointer delta and refreshes selection', () => {
    const applyEditorResize = loadResizeInteraction();
    const calls = [];
    const selectedElement = { _normalized: true, style: {} };
    applyEditorResize({ clientX: 15, clientY: 25 }, {
        selectedElement,
        slide: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
        startX: 5, startY: 5, startLeft: 20, startTop: 30,
        startWidth: 40, startHeight: 50, currentHandle: 'se',
        snapLinesX: [], snapLinesY: [], guideH: { style: {} }, guideV: { style: {} },
        updateSelectionBox: () => calls.push('update'),
    });
    assert.equal(selectedElement.style.width, '50px');
    assert.equal(selectedElement.style.height, '70px');
    assert.equal(selectedElement.style.left, '20px');
    assert.equal(selectedElement.style.top, '30px');
    assert.equal(selectedElement.style.overflow, 'hidden');
    assert.deepEqual(calls, ['update']);
});

test('resize interaction ignores an unnormalized selection', () => {
    const applyEditorResize = loadResizeInteraction();
    const selectedElement = { style: {} };
    applyEditorResize({ clientX: 10, clientY: 10 }, {
        selectedElement, slide: {}, startX: 0, startY: 0, startLeft: 0, startTop: 0,
        startWidth: 10, startHeight: 10, currentHandle: 'se', snapLinesX: [], snapLinesY: [],
        guideH: { style: {} }, guideV: { style: {} }, updateSelectionBox() {},
    });
    assert.deepEqual(selectedElement.style, {});
});
