const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadInstaller() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/background-pointer.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function installEditorBackgroundPointerHandler', 'function installEditorBackgroundPointerHandler') +
        '\nmodule.exports = { installEditorBackgroundPointerHandler };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.installEditorBackgroundPointerHandler;
}

test('background pointer handler selects the hit-tested image slot and captures drag geometry', () => {
    const calls = [];
    const slide = { getBoundingClientRect: () => ({ left: 100, top: 200 }) };
    const target = {
        closest: selector => selector === '.s' ? slide : null,
        getBoundingClientRect: () => ({ left: 130, top: 250 }),
    };
    const clicked = { contentEditable: 'false', closest: () => null };
    let listener;
    const document = {
        addEventListener: () => {},
        elementsFromPoint: () => [target],
        body: { addEventListener: (name, callback) => { assert.equal(name, 'mousedown'); listener = callback; }, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    };
    loadInstaller()({
        document,
        getIsLocked: () => false,
        ensureUI: () => calls.push(['ensure']),
        findEditableTarget: () => null,
        isImageSlotElement: element => element === target,
        isTextEditableElement: () => false,
        selectElement: element => calls.push(['select', element]),
        deselect: () => calls.push(['deselect']),
        getStableDragTarget: element => element,
        createSnapTargets: () => ({ snapLinesX: [10], snapLinesY: [20] }),
        getEditableElementsInSlide: () => [],
        setIsDragging: value => calls.push(['dragging', value]),
        setDragGroup: value => calls.push(['group', value]),
        setActiveDragTarget: value => calls.push(['target', value]),
        setStartX: value => calls.push(['x', value]),
        setStartY: value => calls.push(['y', value]),
        setStartLeft: value => calls.push(['left', value]),
        setStartTop: value => calls.push(['top', value]),
        setSnapLinesX: value => calls.push(['snapX', value]),
        setSnapLinesY: value => calls.push(['snapY', value]),
    });
    const event = { target: clicked, clientX: 11, clientY: 12, prevented: false, preventDefault() { this.prevented = true; } };

    listener(event);

    assert.equal(event.prevented, true);
    assert.deepEqual(calls.map(call => call[0]), ['ensure', 'select', 'dragging', 'group', 'target', 'x', 'y', 'left', 'top', 'snapX', 'snapY']);
    assert.equal(calls[5][1], 11);
    assert.equal(calls[6][1], 12);
    assert.equal(calls[7][1], 30);
    assert.equal(calls[8][1], 50);
});
