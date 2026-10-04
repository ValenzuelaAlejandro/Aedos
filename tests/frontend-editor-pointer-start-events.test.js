const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadInstaller() {
    const module = { exports: {} };
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/pointer-start-events.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function installEditorPointerStartEvents', 'function installEditorPointerStartEvents') +
        '\nmodule.exports = { installEditorPointerStartEvents };';
    vm.runInNewContext(source, { module });
    return module.exports.installEditorPointerStartEvents;
}

function makeTarget(className, rect, parent) {
    return {
        classList: { contains: value => value === className },
        dataset: { handler: 'se' },
        closest: () => parent,
        getBoundingClientRect: () => rect,
    };
}

function install(selectedElement) {
    let listener;
    const changes = [];
    const calls = [];
    loadInstaller()({
        selectionBox: { addEventListener: (name, callback) => { if (name === 'mousedown') listener = callback; } },
        getState: () => ({ selectedElement }),
        updateState: patch => changes.push({ ...patch }),
        saveState: () => calls.push('save'),
        getStableDragTarget: element => { calls.push('target'); return element; },
        document: { body: { getBoundingClientRect: () => ({ left: 10, top: 20 }) } },
    });
    return { listener, changes, calls };
}

test('selection handle starts resize and records the same slide-relative geometry', () => {
    const slide = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
    const selected = makeTarget('', { left: 30, top: 50, width: 80, height: 40 }, slide);
    const rig = install(selected);
    const event = {
        target: makeTarget('editor-resize-handle', {}, slide), clientX: 7, clientY: 9,
        stopPropagation() {}, preventDefault() { this.prevented = true; },
    };
    rig.listener(event);
    assert.deepEqual(rig.changes.map(change => ({ ...change })), [
        { isResizing: true, currentHandle: 'se', startX: 7, startY: 9 },
        { startWidth: 80, startHeight: 40, startLeft: 20, startTop: 30 },
    ]);
    assert.deepEqual(rig.calls, ['save']);
    assert.equal(event.prevented, true);
});

test('selection box starts dragging the stable target after saving undo state', () => {
    const slide = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
    const selected = makeTarget('', { left: 30, top: 50, width: 80, height: 40 }, slide);
    const rig = install(selected);
    const event = {
        target: makeTarget('', {}, slide), clientX: 7, clientY: 9,
        stopPropagation() {}, preventDefault() { this.prevented = true; },
    };
    rig.listener(event);
    assert.equal(rig.changes[0].isDragging, true);
    assert.equal(rig.changes[0].dragGroup.length, 0);
    assert.equal(rig.changes[0].activeDragTarget, selected);
    assert.deepEqual(rig.changes[1], { startX: 7, startY: 9, startLeft: 20, startTop: 30 });
    assert.deepEqual(rig.calls, ['save', 'target']);
    assert.equal(event.prevented, true);
});
