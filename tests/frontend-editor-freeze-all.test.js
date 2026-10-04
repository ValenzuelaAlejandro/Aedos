const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFreezeAll() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/slide-freeze.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorSlideFreeze', 'function createEditorSlideFreeze')
        .replace('export function createEditorFreezeAllSlides', 'function createEditorFreezeAllSlides')
        .replace('export function createEditorElementNormalizer', 'function createEditorElementNormalizer') +
        '\nmodule.exports = { createEditorFreezeAllSlides };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorFreezeAllSlides;
}

test('freezeAllSlides preserves frozen markers, pre-captured rectangles, silent normalization, and repeat skips', () => {
    const firstRect = { left: 1 };
    const secondRect = { left: 2 };
    const first = { getBoundingClientRect: () => firstRect };
    const second = { getBoundingClientRect: () => secondRect };
    const slide = {};
    const frozenSlides = new WeakMap();
    const calls = [];
    const freezeAllSlides = loadFreezeAll()({
        document: { querySelectorAll: selector => { assert.equal(selector, 'section.s'); return [slide]; } },
        frozenSlides,
        getEditableElementsInSlide: () => [first, second],
        getTopLevelEditableElements: () => [first, second],
        normalizeElement: (...args) => calls.push(args),
    });

    freezeAllSlides();
    freezeAllSlides();

    assert.equal(frozenSlides.has(slide), true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], first);
    assert.equal(calls[0][1], slide);
    assert.equal(calls[0][2], true);
    assert.equal(calls[0][3], firstRect);
    assert.equal(calls[1][3], secondRect);
});
