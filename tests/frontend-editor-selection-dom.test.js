const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSelectionDom() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/selection-dom.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorSelectionDom', 'function createEditorSelectionDom') +
        '\nmodule.exports = { createEditorSelectionDom };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorSelectionDom;
}

function createNode() {
    return {
        style: {},
        dataset: {},
        children: [],
        parentElement: null,
        appendChild(child) {
            child.parentElement = this;
            this.children.push(child);
        },
    };
}

test('selection DOM preserves the selection box, handles, toolbar, guides, and idempotent attachment', () => {
    const root = createNode();
    const document = { documentElement: root, createElement: () => createNode() };
    const { selectionBox, handleEls, toolbar, guideH, guideV, ensureUI } =
        loadSelectionDom()({ document });

    assert.equal(selectionBox.className, 'editor-selection-box');
    assert.equal(selectionBox.style.display, 'none');
    assert.equal(selectionBox.style.zIndex, '1000');
    assert.deepEqual(Object.keys(handleEls), ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w']);
    assert.deepEqual(selectionBox.children.map(handle => handle.dataset.handler), ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w']);
    assert.equal(toolbar.className, 'editor-toolbar');
    assert.equal(toolbar.style.display, 'none');
    assert.equal(toolbar.style.zIndex, '1001');
    assert.equal(guideH.className, 'editor-guide editor-guide-h');
    assert.equal(guideV.className, 'editor-guide editor-guide-v');

    ensureUI();
    ensureUI();
    assert.deepEqual(root.children, [selectionBox, toolbar, guideH, guideV]);
});
