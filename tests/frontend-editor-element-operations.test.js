const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadElementOperations() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/element-operations.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorElementOperations', 'function createEditorElementOperations') +
        '\nmodule.exports = { createEditorElementOperations };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorElementOperations;
}

function makeElement(left, top, calls) {
    return {
        style: { left: `${left}px`, top: `${top}px` },
        closest: () => calls.slide,
        cloneNode: () => makeElement(left, top, calls),
        remove: () => calls.push('remove'),
    };
}

test('duplicate offsets the target and grouped elements together by 20px', () => {
    const createOperations = loadElementOperations();
    const calls = [];
    calls.slide = { appendChild: clone => calls.push(['append', clone]) };
    const original = makeElement(12, 8, calls);
    original._stateSavedSinceMousedown = true;
    const child = makeElement(30, 40, calls);
    const operations = createOperations({
        document: { body: {} },
        saveState: () => calls.push('save'),
        freezeSlideLayout() {},
        collectGroup: () => [{ el: child }],
        deselectGroup() {},
        normalizeElement: () => calls.push('normalize'),
        selectElement: element => calls.push(['select', element]),
    });
    operations.duplicateElement(original);
    const clones = calls.filter(call => Array.isArray(call) && call[0] === 'append').map(call => call[1]);
    assert.equal(clones.length, 2);
    assert.equal(clones[0].style.left, '32px');
    assert.equal(clones[0].style.top, '28px');
    assert.equal(clones[0]._stateSavedSinceMousedown, undefined);
    assert.equal(clones[1].style.left, '50px');
    assert.equal(clones[1].style.top, '60px');
});

test('delete freezes, saves, removes grouped items, and deselects', () => {
    const createOperations = loadElementOperations();
    const calls = [];
    calls.slide = {};
    const original = makeElement(0, 0, calls);
    const child = makeElement(0, 0, calls);
    const operations = createOperations({
        document: { body: {} },
        saveState: () => calls.push('save'),
        freezeSlideLayout: () => calls.push('freeze'),
        collectGroup: () => [{ el: child }],
        deselectGroup: () => calls.push('deselect'),
        normalizeElement() {},
        selectElement() {},
    });
    operations.deleteElement(original);
    assert.deepEqual(calls.slice(0, 4), ['freeze', 'save', 'remove', 'remove']);
    assert.equal(calls.at(-1), 'deselect');
});
