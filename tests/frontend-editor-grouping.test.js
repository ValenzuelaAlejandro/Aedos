const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEditorGrouping() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/grouping.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorGrouping', 'function createEditorGrouping') +
        '\nmodule.exports = { createEditorGrouping };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorGrouping;
}

test('visual group contains fully enclosed editables with slide-relative positions', () => {
    const slide = {
        getBoundingClientRect: () => ({ left: 10, top: 20 }),
    };
    const target = {
        closest: () => slide,
        getBoundingClientRect: () => ({ left: 50, right: 250, top: 60, bottom: 180 }),
    };
    const inside = {
        getBoundingClientRect: () => ({ left: 80, right: 120, top: 100, bottom: 130 }),
    };
    const outside = {
        getBoundingClientRect: () => ({ left: 40, right: 70, top: 100, bottom: 130 }),
    };
    const createEditorGrouping = loadEditorGrouping();
    const collectGroup = createEditorGrouping({
        document: { body: slide },
        isSemanticContainer: () => true,
        getEditableElementsInSlide: () => [inside, outside],
    });

    const members = collectGroup(target);
    assert.equal(members.length, 1);
    assert.equal(members[0].el, inside);
    assert.equal(members[0].startLeft, 70);
    assert.equal(members[0].startTop, 80);
});

test('non-container target has no visual group members', () => {
    const slide = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const createEditorGrouping = loadEditorGrouping();
    const collectGroup = createEditorGrouping({
        document: { body: slide },
        isSemanticContainer: () => false,
        getEditableElementsInSlide: () => { throw new Error('must not enumerate'); },
    });

    assert.deepEqual([...collectGroup({ closest: () => slide })], []);
});
