const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPointerSelection() {
    const module = { exports: {} };
    const context = { module, createEditorSnapTargets: () => ({ snapLinesX: [{ val: 4 }], snapLinesY: [{ val: 5 }] }) };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/pointer-selection.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace("import { createEditorSnapTargets } from './snap-targets.js';", '')
        .replace('export function createEditorPointerSelectionHandler', 'function createEditorPointerSelectionHandler') +
        '\nmodule.exports = { createEditorPointerSelectionHandler };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorPointerSelectionHandler;
}

test('pointer selection selects the stable target and records drag start state', () => {
    const createHandler = loadPointerSelection();
    const calls = [];
    const slide = {
        getBoundingClientRect: () => ({ left: 20, top: 30 }),
    };
    const target = {
        getBoundingClientRect: () => ({ left: 60, top: 80 }),
        closest: selector => selector === '.s' ? slide : null,
    };
    const handler = createHandler({
        document: { body: {}, elementsFromPoint: () => [target] },
        getIsLocked: () => false,
        ensureUI() {},
        isImageSlotElement: () => false,
        isTextEditableElement: () => true,
        findEditableTarget: () => target,
        getStableDragTarget: () => target,
        getEditableElementsInSlide: () => [],
        selectElement: element => calls.push(['select', element]),
        deselectGroup: () => calls.push('deselect'),
        setIsDragging: value => calls.push(['dragging', value]),
        setDragGroup: value => calls.push(['group', value]),
        setActiveDragTarget: value => calls.push(['target', value]),
        setStartPointer: (x, y) => calls.push(['pointer', x, y]),
        setStartPosition: (x, y) => calls.push(['position', x, y]),
        setSnapLines: (x, y) => calls.push(['snaps', x[0].val, y[0].val]),
    });
    const event = { target, clientX: 7, clientY: 9, preventDefault: () => calls.push('prevent') };
    handler(event);
    assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), [
        'select', 'dragging', 'group', 'target', 'pointer', 'position', 'snaps', 'prevent',
    ]);
    assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === 'position'), ['position', 40, 50]);
});
