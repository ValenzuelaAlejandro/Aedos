const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('iframe editor loads its native module and imports private feature helpers', () => {
    const app = read('src/frontend/scripts/app.js');
    const editor = read('src/frontend/editor/editor.js');

    assert.match(app, /<script type="module" src="\/editor\/editor\.js\?v=4"><\/script>/);
    assert.match(editor, /import \{ createAedosEditorSemantics \} from '\.\.\/features\/editor\/semantics\.js';/);
    assert.match(editor, /import \{ createEditorHistory \} from '\.\.\/features\/editor\/history\.js';/);
    assert.match(editor, /import \{ calculateEditorSelectionGeometry \} from '\.\.\/features\/editor\/selection-geometry\.js';/);
    assert.doesNotMatch(app, /<script src="\/features\/editor\/(?:semantics|history|selection-geometry)\.js/);
});

test('private editor helper factories are no longer window globals', () => {
    const sources = [
        read('src/frontend/features/editor/semantics.js'),
        read('src/frontend/features/editor/history.js'),
        read('src/frontend/features/editor/selection-geometry.js'),
    ].join('\n');

    assert.doesNotMatch(sources, /window\.AedosEditor(?:Semantics|History|SelectionGeometry)/);
    assert.match(read('src/frontend/editor/editor.js'), /window\.editableSelectors = editableSelectors/);
    assert.match(read('src/frontend/features/tools/tools.js'), /iframeWin\.editableSelectors/);
});

test('shared HTTP/SSE service is a native module with a temporary compatibility facade', () => {
    const index = read('src/frontend/index.html');
    const service = read('src/frontend/features/shared/http-sse.js');

    assert.match(index, /<script type="module" src="features\/shared\/http-sse\.js\?v=1"><\/script>/);
    assert.match(service, /export function (readReader|openResponse)/);
    assert.match(service, /window\.AedosHttpSse = Object\.freeze\(\{ openResponse, readReader \}\)/);
});

test('chat and outline renderers are native modules with explicit shared escaping import', () => {
    const index = read('src/frontend/index.html');
    const chat = read('src/frontend/features/chat/attachment-renderer.js');
    const outline = read('src/frontend/features/outline/slide-renderer.js');

    assert.match(index, /<script type="module" src="features\/chat\/attachment-renderer\.js\?v=2"><\/script>/);
    assert.match(index, /<script type="module" src="features\/outline\/slide-renderer\.js\?v=2"><\/script>/);
    assert.match(chat, /export function escapeHtml/);
    assert.match(chat, /export function renderFileChip/);
    assert.match(outline, /import \{ escapeHtml \} from '\.\.\/chat\/attachment-renderer\.js\?v=2'/);
    assert.match(outline, /export function renderSlides/);
    assert.match(chat, /window\.AedosChatRenderer = Object\.freeze\(\{ renderFileChip \}\)/);
    assert.match(outline, /window\.AedosOutlineRenderer = Object\.freeze\(\{ renderSlides \}\)/);
});
