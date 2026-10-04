const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadColorPicker() {
    const module = { exports: {} };
    const context = { module, Set, Array };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/color-picker.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorColorPicker', 'function createEditorColorPicker') +
        '\nmodule.exports = { createEditorColorPicker };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorColorPicker;
}

test('color palette preserves presentation variables and fallback colors', () => {
    const createEditorColorPicker = loadColorPicker();
    const rootStyle = { getPropertyValue: name => name === '--accent' ? '#123456' : '' };
    const picker = createEditorColorPicker({
        document: { documentElement: {}, body: { querySelectorAll: () => [] } },
        window: { getComputedStyle: () => rootStyle },
        getSelectedElement: () => null,
        getActiveColorAction: () => null,
        saveState() {},
    });
    assert.deepEqual(Array.from(picker.getDynamicPalette()), [
        '#123456', '#FFFFFF', '#000000', '#5D5DFF', '#FF5D5D', '#5DFF5D',
    ]);
});

test('color picker keeps the same-anchor toggle behavior', () => {
    const createEditorColorPicker = loadColorPicker();
    const swatches = [];
    const element = {
        style: { display: 'none' },
        dataset: {},
        set innerHTML(_value) {},
        querySelectorAll: () => swatches,
    };
    const picker = createEditorColorPicker({
        document: { getElementById: () => element, documentElement: {}, body: { querySelectorAll: () => [] } },
        window: { getComputedStyle: () => ({ getPropertyValue: () => '' }) },
        getSelectedElement: () => null,
        getActiveColorAction: () => null,
        saveState() {},
    });
    const anchor = { id: 'color-button' };
    picker.showColorPicker(anchor);
    assert.equal(element.style.display, 'grid');
    picker.showColorPicker(anchor);
    assert.equal(element.style.display, 'none');
});
