const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const modulePath = path.join(__dirname, '../src/frontend/features/outline/stream-lifecycle.js');

test('outline stream lifecycle preserves preparation, finalization, and stop callbacks', () => {
    const calls = [];
    const classList = () => ({ add: value => calls.push(`add:${value}`), remove: value => calls.push(`remove:${value}`) });
    const element = () => ({ value: '', disabled: false, style: {}, classList: classList() });
    const elements = Object.fromEntries(['btn-generate', 'btn-lang-dropdown', 'suggestion-pills-row', 'outline-title-input', 'outline-tone-select', 'outline-audience-select', 'outline-density-select', 'outline-subtitle-input'].map(id => [id, element()]));
    const slideContainer = { innerHTML: 'old slides' };
    const chipsContainer = { innerHTML: 'old chips' };
    const outlineContainer = { classList: classList() };
    const outlineDom = { container: outlineContainer, slidesContainer: slideContainer, chipsContainer, generateButton: element(), addSlideButton: element() };
    const document = {
        getElementById: id => elements[id] || null,
        querySelector: selector => selector === '.app-microcopy' || selector === '.chat-counter-row' ? element() : null,
    };
    const state = { isLoading: false, skeleton: { slides: [] }, mode: 'flash', maxSlides: 15 };
    const global = { clearTimeout: timeout => calls.push(`clear:${timeout}`), AedosOutlineStreamRenderer: { renderPartialOutline: (...args) => calls.push(['partial', ...args]) } };
    vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), { window: global }, { filename: modulePath });
    const lifecycle = global.AedosOutlineStreaming.createOutlineStreaming({
        document,
        getState: () => state,
        getActiveContainer: () => outlineContainer,
        mountActiveContainer: () => outlineDom,
        getOutlineDom: () => outlineDom,
        getChipsTimeout: () => 17,
        scrollToBottom: () => calls.push('scroll'),
        renderSlides: () => calls.push('slides'),
        renderChips: skeleton => calls.push(['chips', skeleton]),
        validateGenerateButton: () => calls.push('validate'),
    });

    lifecycle.prepareOutlineStreaming('pro');
    assert.equal(state.isLoading, true);
    assert.equal(state.skeleton, null);
    assert.equal(state.maxSlides, 8);
    assert.equal(slideContainer.innerHTML, '');
    assert.equal(chipsContainer.innerHTML, '');
    assert.equal(elements['btn-lang-dropdown'].disabled, true);
    assert.ok(calls.includes('clear:17'));

    const skeleton = { topic: 'Topic', slides: [], tone: 'warm', audience: 'students', density: 'compact', subtitle_context: 'Context' };
    lifecycle.finalizeStreamingOutline(skeleton);
    assert.equal(state.skeleton, skeleton);
    assert.equal(state.isLoading, false);
    assert.equal(elements['outline-title-input'].value, 'Topic');
    assert.equal(elements['outline-tone-select'].value, 'warm');
    assert.deepEqual(calls.slice(-4).map(call => Array.isArray(call) ? call[0] : call), ['slides', 'chips', 'remove:is-generating', 'validate']);
    lifecycle.stopOutlineGeneration();
    assert.equal(state.isLoading, false);
    assert.deepEqual(calls.slice(-4).map(call => Array.isArray(call) ? call[0] : call), ['slides', 'chips', 'remove:is-generating', 'validate']);
});
