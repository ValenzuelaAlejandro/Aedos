const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const storePath = path.join(root, 'src/frontend/features/shared/outline-store.js');
const fixturePath = path.join(root, 'tests/fixtures/frontend/stores/outline-default.json');

function loadOutlineStore() {
    const window = {};
    vm.runInNewContext(fs.readFileSync(storePath, 'utf8'), { window }, { filename: storePath });
    return window;
}

test('outline store preserves its legacy window state and defaults', () => {
    const window = loadOutlineStore();
    const expected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const store = window.AedosStores.outline;

    assert.deepEqual(JSON.parse(JSON.stringify(store.getState())), expected);
    assert.equal(window.outlineEditorState, store.getState());
});

test('legacy outline state assignments and mutations remain visible through the store', () => {
    const window = loadOutlineStore();
    const store = window.AedosStores.outline;
    const replacement = { skeleton: { slides: [] }, mode: 'pro', maxSlides: 8, isLoading: true, activeContainer: null };

    window.outlineEditorState = replacement;
    assert.equal(store.getState(), replacement);

    window.outlineEditorState.skeleton = null;
    assert.equal(store.getState().skeleton, null);

    store.clearDraft();
    assert.equal(window.outlineEditorState, replacement);
    assert.equal(window.outlineEditorState.skeleton, null);
    assert.equal(window.outlineEditorState.isLoading, false);
    assert.equal(window.outlineEditorState.mode, 'pro');
    assert.equal(window.outlineEditorState.maxSlides, 8);
});
