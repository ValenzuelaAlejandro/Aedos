const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const storePath = path.join(root, 'src/frontend/features/shared/outline-store.js');
const fixturePath = path.join(root, 'tests/fixtures/frontend/stores/outline-default.json');
const generationStorePath = path.join(root, 'src/frontend/features/shared/generation-store.js');
const generationFixturePath = path.join(root, 'tests/fixtures/frontend/stores/generation-default.json');

function loadOutlineStore() {
    const window = {};
    vm.runInNewContext(fs.readFileSync(storePath, 'utf8'), { window }, { filename: storePath });
    return window;
}

function loadGenerationStore() {
    const window = {};
    vm.runInNewContext(fs.readFileSync(generationStorePath, 'utf8'), { window }, { filename: generationStorePath });
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

test('generation store preserves defaults and legacy writable globals', () => {
    const window = loadGenerationStore();
    const expected = JSON.parse(fs.readFileSync(generationFixturePath, 'utf8'));
    const store = window.AedosStores.generation;

    assert.deepEqual(JSON.parse(JSON.stringify(store.state)), expected);
    assert.equal(window._activeGenController, null);
    assert.equal(window._attachedFiles, undefined);
    assert.equal(window._backupSkeleton, undefined);
    assert.equal(window._pendingGenerateBodyData, undefined);
    assert.equal(window._pendingGenerateHeaders, undefined);

    const controller = { abort() {} };
    const files = [{ name: 'outline.pdf' }];
    const skeleton = { slides: [] };
    const body = { prompt: 'example' };
    const headers = { 'content-type': 'application/json' };
    window._activeGenController = controller;
    window._attachedFiles = files;
    window._backupSkeleton = skeleton;
    window._pendingGenerateBodyData = body;
    window._pendingGenerateHeaders = headers;

    assert.equal(store.state.activeController, controller);
    assert.equal(store.state.attachedFiles, files);
    assert.equal(store.state.backupSkeleton, skeleton);
    assert.equal(store.state.pendingBodyData, body);
    assert.equal(store.state.pendingHeaders, headers);
});
