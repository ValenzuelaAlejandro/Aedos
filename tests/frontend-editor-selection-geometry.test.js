const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSelectionGeometry() {
    const window = {};
    const context = { window };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/selection-geometry.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function calculateEditorSelectionGeometry', 'function calculateEditorSelectionGeometry') +
        '\nwindow.AedosEditorSelectionGeometry = Object.freeze({ calculate: calculateEditorSelectionGeometry });';
    vm.runInContext(source, context, { filename: sourcePath });
    return window.AedosEditorSelectionGeometry;
}

test('selection geometry preserves unclipped placement and toolbar positioning', () => {
    const geometry = loadSelectionGeometry();

    assert.deepEqual({ ...geometry.calculate(
        { left: 100, top: 100, width: 200, height: 100 },
        { width: 1440, height: 900 },
        340,
    ) }, {
        left: 100,
        top: 100,
        width: 200,
        height: 100,
        toolbarLeft: 100,
        toolbarTop: 44,
        isVisible: true,
        isSmall: false,
    });
});

test('selection geometry clips to the viewport and applies edge toolbar fallbacks', () => {
    const geometry = loadSelectionGeometry();

    assert.deepEqual({ ...geometry.calculate(
        { left: -30, top: 5, width: 80, height: 40 },
        { width: 100, height: 100 },
        90,
    ) }, {
        left: 0,
        top: 5,
        width: 50,
        height: 40,
        toolbarLeft: 12,
        toolbarTop: 10,
        isVisible: true,
        isSmall: true,
    });
});

test('selection geometry hides fully offscreen targets and uses the default toolbar width', () => {
    const geometry = loadSelectionGeometry();

    assert.deepEqual({ ...geometry.calculate(
        { left: -40, top: 20, width: 10, height: 20 },
        { width: 100, height: 100 },
        0,
    ) }, {
        left: 0,
        top: 20,
        width: 0,
        height: 20,
        toolbarLeft: 12,
        toolbarTop: 10,
        isVisible: false,
        isSmall: true,
    });
});
