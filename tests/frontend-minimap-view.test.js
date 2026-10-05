const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeMinimapFixture() {
    const items = [
        {
            classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
            offsetHeight: 80,
        },
        {
            classList: { contains: () => true, add() {}, remove() {}, toggle() {} },
            offsetHeight: 80,
        },
        {
            classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
            offsetHeight: 80,
        },
        {
            classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
            offsetHeight: 80,
        },
        {
            classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
            offsetHeight: 80,
        },
    ];
    const minimapList = {
        scrollHeight: 1000,
        style: {},
        querySelectorAll(selector) {
            if (selector === '.minimap-item') return items;
            if (selector === '.minimap-item:not(.is-dragging)') return dragItems;
            return [];
        },
    };
    const dragItems = [
        { getBoundingClientRect: () => ({ top: 0, height: 20 }) },
        { getBoundingClientRect: () => ({ top: 30, height: 20 }) },
    ];
    const slides = [
        { classList: { contains: () => false } },
        { classList: { contains: () => false } },
    ];
    const container = {
        appendChild(node) {
            this.appended.push(node);
        },
        appended: [],
    };
    slides.forEach((slide) => {
        slide.parentElement = container;
    });
    const ids = {
        'editor-minimap': { clientHeight: 500 },
        'btn-add-slide': { offsetHeight: 40 },
    };
    const calls = { build: 0, save: 0, dots: 0 };
    const window = {
        getComputedStyle: () => ({ marginTop: '2px', marginBottom: '2px' }),
        regenerateDotsCount: () => {
            calls.dots++;
        },
    };
    const document = { getElementById: (id) => ids[id] || null };
    return {
        calls,
        container,
        context: {
            window,
            document,
            requestAnimationFrame: (callback) => callback(),
            setTimeout,
        },
        dragItems,
        minimapList,
        slides,
    };
}

function loadMinimapView() {
    const fixture = makeMinimapFixture();
    const { context, calls, minimapList, slides } = fixture;
    const { window } = context;
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/minimap/minimap-view.js');
    vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });

    const view = window.AedosMinimapView.create({
        iframeDoc: { querySelectorAll: () => slides },
        iframeWin: {
            editorSaveState: () => {
                calls.save++;
            },
        },
        minimapList,
        buildMinimap: () => {
            calls.build++;
        },
    });
    assert.equal(typeof window.AedosMinimapView.create, 'function');

    return { ...fixture, view };
}

test('minimap view preserves active centering and drag insertion target', () => {
    const { dragItems, minimapList, view } = loadMinimapView();

    view.centerActiveMinimapItem(4);
    assert.equal(minimapList.style.transform, 'translateY(-150px)');
    assert.equal(minimapList.style.transition, 'transform 380ms cubic-bezier(0.4, 0, 0.2, 1)');

    const after = view.getDragAfterElement(
        {
            querySelectorAll: () => dragItems,
        },
        35,
    );
    assert.equal(after, dragItems[1]);
});

test('minimap view persists drag order, rebuilds thumbnails and requests dot sync', () => {
    const { calls, container, slides, minimapList, view } = loadMinimapView();
    const orderedItems = [
        { dataset: { index: '1' }, classList: { contains: () => false } },
        { dataset: { index: '0' }, classList: { contains: () => false } },
    ];
    minimapList.querySelectorAll = () => orderedItems;
    view.syncSlidesOrderToIframe();

    assert.equal(calls.save, 1);
    assert.equal(container.appended[0], slides[1]);
    assert.equal(container.appended[1], slides[0]);
    assert.equal(calls.dots, 1);
    assert.equal(calls.build, 1);
});

test('streaming minimap skeletons keep slide count, active item, and accent cleanup', () => {
    const fixture = makeMinimapFixture();
    const items = [];
    const removedProperties = [];
    const minimapList = {
        _html: 'old',
        get innerHTML() { return this._html; },
        set innerHTML(value) { this._html = value; items.length = 0; },
        style: {},
        querySelectorAll: () => items,
        appendChild(item) { items.push(item); },
    };
    const minimapContainer = {
        clientHeight: 500,
        style: { removeProperty: (name) => removedProperties.push(name) },
    };
    const document = {
        getElementById: (id) => id === 'minimap-list' ? minimapList : id === 'editor-minimap' ? minimapContainer : null,
        createElement: () => ({
            classList: { toggle(name, active) { this.active = active; } },
            appendChild(child) { (this.children ||= []).push(child); },
            style: {},
        }),
    };
    const sourcePath = path.join(__dirname, '../src/frontend/features/minimap/minimap-view.js');
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), fixture.context, { filename: sourcePath });

    const update = fixture.context.window.AedosMinimapView.createSkeletonUpdater({ document });
    update(2);
    assert.equal(minimapList.innerHTML, '');
    assert.equal(items.length, 2);
    assert.equal(items[0].children[1].textContent, 1);
    assert.equal(items[1].className, 'minimap-item skeleton active');
    assert.equal(minimapList.style.transform, 'translateY(79.625px)');

    update(1);
    assert.deepEqual(removedProperties, ['--presentation-accent', '--accent', '--presentation-accent', '--accent']);
    assert.equal(items.length, 1);
    assert.equal(items[0].className, 'minimap-item skeleton active');
});
