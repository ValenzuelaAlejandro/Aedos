const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSelectionUi() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/selection-ui.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorSelectionUi', 'function createEditorSelectionUi') +
        '\nmodule.exports = { createEditorSelectionUi };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorSelectionUi;
}

function createClassList() {
    const values = new Set();
    return {
        add: value => values.add(value),
        remove: value => values.delete(value),
        contains: value => values.has(value),
    };
}

test('selection UI positions visible bounds and suppresses the toolbar while dragging', () => {
    const selectionBox = { style: {}, classList: createClassList() };
    const toolbar = { style: {}, offsetWidth: 120 };
    const rect = { left: 5, top: 10, width: 80, height: 40 };
    const selectedElement = { getBoundingClientRect: () => rect };
    let dragging = false;
    let measured;
    const createEditorSelectionUi = loadSelectionUi();
    const update = createEditorSelectionUi({
        getSelectedElement: () => selectedElement,
        selectionBox,
        toolbar,
        window: { innerWidth: 800, innerHeight: 600 },
        getIsDragging: () => dragging,
        getIsResizing: () => false,
        calculateGeometry: (box, viewport, width) => {
            measured = { box, viewport, width };
            return {
                left: 5, top: 10, width: 80, height: 40,
                toolbarLeft: 5, toolbarTop: 20, isVisible: true, isSmall: true,
            };
        },
    });

    update();
    assert.equal(measured.viewport.width, 800);
    assert.equal(measured.viewport.height, 600);
    assert.equal(measured.width, 120);
    assert.equal(selectionBox.style.display, 'block');
    assert.equal(toolbar.style.display, 'flex');
    assert.equal(selectionBox.classList.contains('editor-small-selection'), true);

    dragging = true;
    update();
    assert.equal(toolbar.style.display, 'none');
});

test('offscreen selection hides the box and toolbar without repositioning them', () => {
    const selectionBox = { style: { left: 'prior' }, classList: createClassList() };
    const toolbar = { style: { left: 'prior' }, offsetWidth: 100 };
    const createEditorSelectionUi = loadSelectionUi();
    const update = createEditorSelectionUi({
        getSelectedElement: () => ({ getBoundingClientRect: () => ({}) }),
        selectionBox,
        toolbar,
        window: { innerWidth: 100, innerHeight: 100 },
        getIsDragging: () => false,
        getIsResizing: () => false,
        calculateGeometry: () => ({ isVisible: false }),
    });

    update();
    assert.equal(selectionBox.style.display, 'none');
    assert.equal(toolbar.style.display, 'none');
    assert.equal(selectionBox.style.left, 'prior');
    assert.equal(toolbar.style.left, 'prior');
});
