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
        .replace('export function createEditorSlideFreeze', 'function createEditorSlideFreeze')
        .replace('export function createEditorElementNormalizer', 'function createEditorElementNormalizer') +
        '\nmodule.exports = { createEditorSlideFreeze, createEditorElementNormalizer };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports;
}

test('freezing captures bounds before normalizing and saves one undo state', () => {
    const slide = {};
    const element = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 30, height: 40 }) };
    const order = [];
    const frozenSlides = new WeakMap();
    const { createEditorSlideFreeze } = loadSlideFreeze();
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
    const { createEditorSlideFreeze } = loadSlideFreeze();
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

test('normalization keeps nested semantic children in place without saving state', () => {
    const element = { style: {}, _normalized: false };
    const createEditorElementNormalizer = loadSlideFreeze().createEditorElementNormalizer;
    const normalize = createEditorElementNormalizer({
        window: { getComputedStyle: () => { throw new Error('must not compute style'); } },
        setTimeout: () => { throw new Error('must not schedule transition'); },
        saveState: () => { throw new Error('must not save'); },
        getNearestSemanticContainerAncestor: () => ({}),
        isTextEditableElement: () => false,
        isTextContainerElement: () => false,
        isHeadingLikeElement: () => false,
        textEditableSelectors: 'h1',
        getInheritedStyles: () => ({}),
    });

    normalize(element, {});
    assert.equal(element._normalized, true);
    assert.deepEqual(element.style, {});
});

test('absolute normalization retains existing position, width buffer, and transition timing', () => {
    const timers = [];
    const element = {
        _normalized: false,
        parentElement: {},
        style: { position: 'absolute', transition: 'left 1s' },
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 60, height: 25 }),
        querySelectorAll: () => [],
    };
    const slide = { getBoundingClientRect: () => ({ left: 10, top: 15 }) };
    const inherited = {
        fontSize: '20px', fontFamily: 'Arial', color: 'red', lineHeight: '24px', textAlign: 'left',
        fontWeight: '400', letterSpacing: '0px', textTransform: 'none', fontVariant: 'normal',
        fontStyle: 'normal', textDecoration: 'none',
    };
    const createEditorElementNormalizer = loadSlideFreeze().createEditorElementNormalizer;
    const normalize = createEditorElementNormalizer({
        window: { getComputedStyle: () => ({ position: 'absolute' }) },
        setTimeout: (callback, delay) => timers.push({ callback, delay }),
        saveState: () => {},
        getNearestSemanticContainerAncestor: () => null,
        isTextEditableElement: () => true,
        isTextContainerElement: () => false,
        isHeadingLikeElement: () => false,
        textEditableSelectors: 'h1',
        getInheritedStyles: () => inherited,
    });

    normalize(element, slide);
    assert.equal(element.style.width, '70px');
    assert.equal(element.style.left, '10px');
    assert.equal(element.style.top, '15px');
    assert.equal(element.style.transition, 'none');
    assert.equal(timers[0].delay, 50);
    timers[0].callback();
    assert.equal(element.style.transition, 'left 1s');
});
