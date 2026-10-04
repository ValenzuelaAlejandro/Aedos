const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFacade() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/compatibility-facade.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function installEditorCompatibilityFacade', 'function installEditorCompatibilityFacade') +
        '\nmodule.exports = { installEditorCompatibilityFacade };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.installEditorCompatibilityFacade;
}

test('compatibility facade keeps selection, history, layer, and arrow window hooks', () => {
    const selected = { value: null };
    const calls = [];
    const child = { style: { position: 'absolute', zIndex: '1' } };
    const sibling = { style: { position: 'absolute', zIndex: '3' } };
    const parent = {
        children: [child, sibling],
        appendChild(element) { this.children = this.children.filter(item => item !== element); this.children.push(element); },
        prepend(element) { this.children = this.children.filter(item => item !== element); this.children.unshift(element); },
    };
    child.parentElement = parent;
    const window = { getComputedStyle: element => element.style };
    const installEditorCompatibilityFacade = loadFacade();
    installEditorCompatibilityFacade({
        window,
        getSelectedElement: () => selected.value,
        getIsJustSelected: () => true,
        getIsDragging: () => false,
        getIsResizing: () => true,
        undo: () => calls.push('undo'),
        redo: () => calls.push('redo'),
        saveState: () => calls.push('save'),
        deselect: () => calls.push('deselect'),
        updateSelection: () => calls.push('update'),
        selectElement: value => { selected.value = value; },
        duplicate: () => calls.push('duplicate'),
        deleteElement: () => calls.push('delete'),
        arrowMove: (key, shift) => calls.push(`${key}:${shift}`),
    });

    assert.equal(window.editorUndo instanceof Function, true);
    assert.equal(window.editorRedo instanceof Function, true);
    assert.equal(window.editorSaveState instanceof Function, true);
    assert.equal(window.editorDeselect instanceof Function, true);
    assert.equal(window.editorUpdateSelection instanceof Function, true);
    assert.equal(window.editorGetSelection(), null);
    assert.equal(window.isJustSelected(), true);
    assert.equal(window.editorIsDragging(), true);
    selected.value = child;
    window.toFront();
    assert.equal(child.style.zIndex, 4);
    window.toBack();
    assert.equal(parent.children[0], child);
    window.editorArrowMove('ArrowRight', true);
    assert.equal(calls.at(-1), 'ArrowRight:true');
});
