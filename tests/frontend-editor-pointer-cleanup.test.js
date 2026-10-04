const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadInstaller() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/pointer-cleanup.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function installEditorPointerCleanup', 'function installEditorPointerCleanup') +
        '\nmodule.exports = { installEditorPointerCleanup };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.installEditorPointerCleanup;
}

test('mouseup cleanup resets drag state, guides, normalization, selection UI, and mousedown flags in order', () => {
    const calls = [];
    const selected = { _normalized: true };
    const editables = [{ _stateSavedSinceMousedown: true }, { _stateSavedSinceMousedown: true }];
    let listener;
    const guideH = { style: { display: 'block' } };
    const guideV = { style: { display: 'block' } };
    loadInstaller()({
        document: { addEventListener: (type, callback) => { assert.equal(type, 'mouseup'); listener = callback; } },
        setIsDragging: value => calls.push(['dragging', value]),
        setIsResizing: value => calls.push(['resizing', value]),
        setCurrentHandle: value => calls.push(['handle', value]),
        setDragGroup: value => calls.push(['group', value]),
        setActiveDragTarget: value => calls.push(['target', value]),
        guideH,
        guideV,
        getSelectedElement: () => selected,
        updateSelectionBox: () => calls.push(['update']),
        getAllEditables: () => { calls.push(['editables']); return editables; },
    });

    listener();

    assert.deepEqual(calls.map(call => call[0]), ['dragging', 'resizing', 'handle', 'group', 'target', 'update', 'editables']);
    assert.equal(guideH.style.display, 'none');
    assert.equal(guideV.style.display, 'none');
    assert.equal('_normalized' in selected, false);
    assert.equal(editables.some(element => '_stateSavedSinceMousedown' in element), false);
});
