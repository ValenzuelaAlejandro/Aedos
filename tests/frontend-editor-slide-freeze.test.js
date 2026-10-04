const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSlideFreeze() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/slide-freeze.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorSlideFreeze', 'function createEditorSlideFreeze') +
        '\nmodule.exports = { createEditorSlideFreeze };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorSlideFreeze;
}

test('freezing captures bounds before normalizing and saves one undo state', () => {
    const slide = {};
    const element = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 30, height: 40 }) };
    const order = [];
    const frozenSlides = new WeakMap();
    const createEditorSlideFreeze = loadSlideFreeze();
    const freeze = createEditorSlideFreeze({
        frozenSlides,
        saveState: () => order.push('save'),
        getEditableElementsInSlide: () => [element],
        getTopLevelEditableElements: () => [element],
        normalizeElement: (target, targetSlide, silent, rect) => {
            assert.equal(target, element);
            assert.equal(targetSlide, slide);
            assert.equal(silent, true);
            assert.equal(rect.left, 10);
            order.push('normalize');
        },
    });

    freeze(slide);
    freeze(slide);
    assert.deepEqual(order, ['save', 'normalize']);
    assert.equal(frozenSlides.get(slide), true);
});

test('empty slides are marked frozen without creating undo state', () => {
    const slide = {};
    const frozenSlides = new WeakMap();
    const createEditorSlideFreeze = loadSlideFreeze();
    const freeze = createEditorSlideFreeze({
        frozenSlides,
        saveState: () => { throw new Error('must not save'); },
        getEditableElementsInSlide: () => [],
        getTopLevelEditableElements: () => [],
        normalizeElement: () => { throw new Error('must not normalize'); },
    });

    freeze(slide);
    assert.equal(frozenSlides.get(slide), true);
});
