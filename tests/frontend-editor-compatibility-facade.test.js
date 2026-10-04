const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCompatibilityFacade() {
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

test('compatibility facade retains the legacy parent-frame editor methods', () => {
    const calls = [];
    const selected = { value: null };
    const first = { style: { position: 'absolute', zIndex: '2' } };
    const second = { style: { position: 'absolute', zIndex: '4' } };
    const parent = {
        children: [first, second],
        appendChild(element) {
            this.children = this.children.filter(child => child !== element);
            this.children.push(element);
            element.parentElement = this;
        },
        prepend(element) {
            this.children = this.children.filter(child => child !== element);
            this.children.unshift(element);
            element.parentElement = this;
        },
    };
    const element = {
        parentElement: parent,
        style: { position: 'absolute', zIndex: '1' },
    };
    parent.children.unshift(element);
    const window = {
        getComputedStyle: target => target.style,
    };
    const installEditorCompatibilityFacade = loadCompatibilityFacade();

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
        select: target => { selected.value = target; calls.push('select'); },
        duplicate: () => calls.push('duplicate'),
        deleteElement: () => calls.push('delete'),
        arrowMove: (key, shift) => calls.push(`arrow:${key}:${shift}`),
        resolveDragCollision: () => ({ left: 0, top: 0 }),
    });

    assert.equal(typeof window.editorUndo, 'function');
    assert.equal(typeof window.editorRedo, 'function');
    assert.equal(typeof window.editorSaveState, 'function');
    assert.equal(typeof window.editorDeselect, 'function');
    assert.equal(typeof window.editorUpdateSelection, 'function');
    assert.equal(typeof window.editorGetSelection, 'function');
    assert.equal(typeof window.editorSelect, 'function');
    assert.equal(typeof window.editorDuplicateSelection, 'function');
    assert.equal(typeof window.editorDeleteSelection, 'function');
    assert.equal(window.isJustSelected(), true);
    assert.equal(window.editorIsDragging(), true);

    selected.value = element;
    window.toFront();
    assert.equal(element.style.zIndex, 5);
    assert.equal(parent.children.at(-1), element);
    window.toBack();
    assert.equal(element.style.zIndex, 1);
    assert.equal(parent.children[0], element);
    window.editorArrowMove('ArrowRight', true);
    assert.equal(calls.at(-1), 'arrow:ArrowRight:true');
});
