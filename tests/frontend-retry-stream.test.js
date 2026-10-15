const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
    const window = {};
    for (const file of ['src/frontend/features/preview/markup-buffer.js', 'src/frontend/features/generation/retry-status.js']) {
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window });
    }
    return window;
}

test('retry status is discreet, translated to output language, and restored only on content', () => {
    const app = load();
    const labels = [];
    const state = { targetLanguage: 'es' };
    const status = app.AedosStreamRetry.create({ getLanguage: () => app.AedosStreamRetry.language(state),
        normal: 'slides', setText: label => labels.push(label) });
    status.reset();
    assert.deepEqual(labels, ['Reintentando...']);
    assert.equal(status.retrying, true);
    status.content();
    assert.deepEqual(labels, ['Reintentando...', 'Generando presentación…']);
    status.content();
    assert.equal(labels.length, 2);
    state.targetLanguage = 'de';
    status.reset();
    assert.equal(labels.at(-1), 'Erneuter Versuch...');
    assert.equal(app.AedosStreamRetry.language({ targetLanguage: 'auto' }, 'fr'), 'fr');
    for (const language of ['es', 'en', 'fr', 'pt', 'de', 'it', 'zh', 'ja', 'ru', 'ar']) {
        assert.ok(app.AedosStreamRetry.text(language, 'retry'));
        assert.ok(app.AedosStreamRetry.text(language, 'slides'));
    }
});

test('presentation reset disposes failed iframe and pending markup before a new live stream', () => {
    const app = load();
    const oldWrites = [], newWrites = [], timers = new Map();
    const oldDoc = { write: markup => oldWrites.push(markup), close() {} };
    const freshDoc = { write: markup => newWrites.push(markup), close() {} };
    const setTimeout = callback => { const id = timers.size + 1; timers.set(id, callback); return id; };
    const clearTimeout = id => timers.delete(id);
    const buffer = app.AedosPreview.createPreviewMarkupBuffer({ iframeDoc: oldDoc, setTimeout, clearTimeout });
    buffer.queue('FAILED SLIDE');
    const fresh = { contentDocument: freshDoc, contentWindow: {} };
    let removed;
    const old = { contentWindow: {}, cloneNode: () => fresh,
        parentNode: { replaceChild(node, previous) { assert.equal(node, fresh); removed = previous; } } };
    const previewState = { previewIframe: old, generatedHtml: 'FAILED', totalSlides: 5, currentSlide: 4 };
    let cleared = 0;
    const result = app.AedosStreamRetry.resetPreview({ previewState, previewMarkupBuffer: buffer,
        previewContainer: { classList: { add: value => assert.equal(value, 'is-awaiting-first-slide') } },
        document: { getElementById: () => ({ replaceChildren() { cleared++; } }) }, setTimeout, clearTimeout });
    assert.equal(timers.size, 0);
    assert.equal(removed, old);
    assert.notEqual(old.contentWindow, previewState.previewIframe.contentWindow);
    assert.equal(previewState.generatedHtml, '');
    assert.equal(previewState.totalSlides, 0);
    assert.equal(cleared, 2);
    result.previewMarkupBuffer.queue('COMPLETE NEW SLIDE');
    result.previewMarkupBuffer.finish();
    assert.deepEqual(oldWrites, []);
    assert.deepEqual(newWrites, ['COMPLETE NEW SLIDE']);
});
