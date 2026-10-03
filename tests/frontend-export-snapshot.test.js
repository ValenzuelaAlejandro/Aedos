const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const snapshotPath = path.join(root, 'src/frontend/features/export/export-snapshot.js');

function createStyle(values = {}) {
    return Object.assign({ width: '', minWidth: '', whiteSpace: '', flex: '', height: '', overflow: '', position: '', boxSizing: '', transform: '', display: '', flexDirection: '', transition: '', margin: '', padding: '' }, values);
}

function createHarness() {
    const order = [];
    const removed = [];
    const removedClasses = [];
    const childOne = {
        style: createStyle({ width: 'initial-one', minWidth: 'min-one', whiteSpace: 'pre-wrap' }),
        getBoundingClientRect: () => ({ width: 55, height: 12 }),
    };
    const childTwo = {
        style: createStyle({ width: 'initial-two', minWidth: 'min-two', whiteSpace: 'normal' }),
        getBoundingClientRect: () => ({ width: 80, height: 36 }),
    };
    const textChildren = [childOne, childTwo];
    const layoutContainer = { querySelectorAll: () => textChildren };
    const removalNodes = new Map();
    const recordRemoval = (selector, count = 1) => {
        const nodes = Array.from({ length: count }, (_, index) => ({
            remove() { removed.push(`${selector}:${index}`); },
        }));
        removalNodes.set(selector, nodes);
    };
    recordRemoval('.editor-selection-box, .editor-toolbar, .editor-color-picker, .editor-guide', 2);
    recordRemoval('.preview-injected-style');
    recordRemoval('.skeleton-injector');
    recordRemoval('#temp-skeleton');
    recordRemoval('.img-replace-overlay');
    recordRemoval('.preview-file-input');

    const body = { style: createStyle({ transform: 'carousel', display: 'flex', flexDirection: 'row', transition: 'all', width: '100%', margin: '2px', padding: '2px', overflow: 'hidden' }) };
    const wrapper = { style: createStyle({ transform: 'carousel', display: 'flex', flexDirection: 'row', transition: 'all', width: '100%', margin: '2px', padding: '2px' }) };
    const slide = {
        classList: { remove: (name) => removedClasses.push(name) },
        style: createStyle({ flex: '1', width: '50%', height: '80%', overflow: 'auto', position: 'relative', boxSizing: 'content-box' }),
        parentElement: wrapper,
    };
    const clone = {
        querySelectorAll(selector) {
            if (selector === '[data-container="true"], div.stat-box, div.card, div.step-item, div.timeline-item, .quote-block, blockquote, ul, ol, .flex-row, .flex-col, .grid-2, .grid-3, [class*="card"], [class*="box"]') return [];
            if (selector === 'section') return [slide];
            return removalNodes.get(selector) || [];
        },
        querySelector(selector) {
            if (selector === 'body') return body;
            return (removalNodes.get(selector) || [])[0] || null;
        },
        get outerHTML() { return '<html><body>clean</body></html>'; },
    };
    const iframeDoc = {
        defaultView: { getComputedStyle: () => ({ lineHeight: '12px', fontSize: '10px' }) },
        documentElement: {
            cloneNode(deep) {
                order.push(`clone:${deep}`);
                assert.equal(childOne.style.whiteSpace, 'nowrap');
                assert.equal(childTwo.style.width, '80px');
                assert.equal(childTwo.style.minWidth, '80px');
                return clone;
            },
        },
        querySelectorAll(selector) {
            if (selector === '[data-container="true"], div.stat-box, div.card, div.step-item, div.timeline-item, .quote-block, blockquote, ul, ol, .flex-row, .flex-col, .grid-2, .grid-3, [class*="card"], [class*="box"]') return [layoutContainer];
            return [];
        },
    };
    const iframeWin = {
        document: iframeDoc,
        editorDeselect() { order.push('deselect'); },
        freezeAllSlides() { order.push('freeze'); },
    };
    return {
        order,
        removed,
        removedClasses,
        childOne,
        childTwo,
        body,
        wrapper,
        slide,
        iframe: { contentWindow: iframeWin, contentDocument: iframeDoc },
    };
}

function loadSnapshot() {
    const window = {};
    vm.runInNewContext(fs.readFileSync(snapshotPath, 'utf8'), { window }, { filename: snapshotPath });
    return window.AedosExportSnapshot;
}

test('export snapshot preserves deselect/freeze order, clones cleanup and restores live measurements', () => {
    const snapshot = loadSnapshot();
    const harness = createHarness();

    const html = snapshot.createHtml(harness.iframe);

    assert.equal(html, '<!DOCTYPE html><html><body>clean</body></html>');
    assert.deepEqual(harness.order.slice(0, 3), ['deselect', 'freeze', 'clone:true']);
    assert.equal(harness.removed.length, 7);
    assert.equal(harness.slide.style.flex, '');
    assert.equal(harness.slide.style.width, '');
    assert.deepEqual(harness.removedClasses, ['active']);
    assert.equal(harness.body.style.transform, '');
    assert.equal(harness.body.style.display, '');
    assert.equal(harness.wrapper.style.transform, '');
    assert.equal(harness.childOne.style.whiteSpace, 'pre-wrap');
    assert.equal(harness.childOne.style.width, 'initial-one');
    assert.equal(harness.childTwo.style.width, 'initial-two');
    assert.equal(harness.childTwo.style.minWidth, 'min-two');
});
