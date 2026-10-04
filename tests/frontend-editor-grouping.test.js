const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGrouping() {
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

test('grouping includes only fully-contained editable nodes and retains slide-relative origins', () => {
    const createEditorGrouping = loadGrouping();
    const slide = { getBoundingClientRect: () => ({ left: 100, top: 200 }) };
    const container = {
        closest: selector => selector === '.s' ? slide : null,
        getBoundingClientRect: () => ({ left: 120, top: 230, right: 300, bottom: 380 }),
    };
    const inside = { getBoundingClientRect: () => ({ left: 130, top: 240, right: 180, bottom: 260 }) };
    const outside = { getBoundingClientRect: () => ({ left: 290, top: 240, right: 320, bottom: 260 }) };
    const collectGroup = createEditorGrouping({
        document: { body: {} },
        isSemanticContainer: () => true,
        getEditableElementsInSlide: () => [inside, outside],
    });
    const group = collectGroup(container);
    assert.equal(group.length, 1);
    assert.equal(group[0].el, inside);
    assert.equal(group[0].startLeft, 30);
    assert.equal(group[0].startTop, 40);
});
