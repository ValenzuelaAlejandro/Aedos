const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadKeyboardHandler() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/keyboard.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorKeyboardHandler', 'function createEditorKeyboardHandler') +
        '\nmodule.exports = { createEditorKeyboardHandler };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorKeyboardHandler;
}

function createEvent(key, extra = {}) {
    return {
        key,
        prevented: false,
        preventDefault() { this.prevented = true; },
        ...extra,
    };
}

function createHandler(overrides = {}) {
    const calls = [];
    const windowEvents = [];
    const defaults = {
        document: { activeElement: null, body: {}, querySelector: () => null },
        window: { dispatchEvent: event => windowEvents.push(event.type) },
        CustomEvent: function CustomEvent(type) { this.type = type; },
        setTimeout: callback => calls.push(['timer', callback]),
        getSelectedElement: () => null,
        getIsLocked: () => false,
        undo: () => calls.push(['undo']),
        redo: () => calls.push(['redo']),
        saveState: () => calls.push(['save']),
        collectGroup: () => [],
        getInheritedStyles: () => ({}),
        getStableDragTarget: element => element,
        normalizeElement: () => {},
        deleteElement: element => calls.push(['delete', element]),
        selectElement: element => calls.push(['select', element]),
        duplicateElement: element => calls.push(['duplicate', element]),
        resolveDragCollision: rect => ({ left: rect.left, top: rect.top }),
        updateSelectionBox: () => calls.push(['update']),
        moveSelectedElementByArrow: (key, shift) => calls.push(['arrow', key, shift]),
    };
    const handler = loadKeyboardHandler()({ ...defaults, ...overrides });
    return { handler, calls, windowEvents };
}

test('left/right arrows still navigate the presentation while locked and unselected', () => {
    const { handler, windowEvents } = createHandler({ getIsLocked: () => true });
    const event = createEvent('ArrowLeft');

    handler(event);

    assert.deepEqual(windowEvents, ['navigate-prev']);
    assert.equal(event.prevented, true);
});

test('keyboard undo/redo and delete keep their existing command dispatch', () => {
    const selected = {};
    const { handler, calls } = createHandler({ getSelectedElement: () => selected });
    const undoEvent = createEvent('z', { ctrlKey: true });
    const deleteEvent = createEvent('Delete');

    handler(undoEvent);
    handler(deleteEvent);

    assert.deepEqual(calls.map(call => call[0]), ['undo', 'delete']);
    assert.equal(undoEvent.prevented, true);
    assert.equal(deleteEvent.prevented, true);
    assert.equal(calls[1][1], selected);
});
