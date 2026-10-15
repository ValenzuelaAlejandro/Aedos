'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStage1Prompt } = require('../../src/backend/prompts/stage1-content');
const { completeOutlineSlides } = require('../../src/backend/pipeline/outline-completion');
const { countSlides, countCompleteSlides, extractCompleteSlides, appendSlides } = require('../../src/backend/pipeline/slide-output');

test('Stage 1 asks for the exact requested outline count, including Pro 15', () => {
    const prompt = buildStage1Prompt('climate systems', 'en', 15);
    assert.match(prompt, /Return exactly 15 slides/);
    assert.match(prompt, /"slide_count": 15/);
    assert.match(prompt, /Exactly 15 items/);
    assert.doesNotMatch(prompt, /NEVER exceed 8/);
});

test('outline completion requests only missing indexes and preserves existing slides', async () => {
    const selectedModel = { id: 'model/user-selected' };
    let requestedPrompt = '';
    let streamCalls = 0;
    const original = { topic: 'Solar power', slide_count: 2, slides: [
        { index: 1, title: 'Cover' }, { index: 2, title: 'Basics' }
    ] };
    const result = await completeOutlineSlides({
        contentJson: original,
        requestedSlides: 4,
        rawInput: 'Solar power',
        targetLanguage: 'en',
        selectedModel,
        callModel: async (prompt, _files, options) => {
            requestedPrompt = prompt;
            assert.equal(options.selectedModel, selectedModel);
            streamCalls += 1;
            return { stream: (async function* () {
                yield JSON.stringify({ slides: [
                    { index: 3, title: 'Storage' }, { index: 4, title: 'Grid' }
                ] });
            })() };
        },
        extractJson: JSON.parse
    });
    assert.equal(streamCalls, 1);
    assert.match(requestedPrompt, /missing slide indexes: 3, 4/);
    assert.match(requestedPrompt, /Do not return or rewrite any existing slide/i);
    assert.deepEqual(result.slides.map(slide => slide.index), [1, 2, 3, 4]);
    assert.equal(result.slide_count, 4);
    assert.equal(result.slides[0].title, 'Cover');
});

test('slide extraction discards incomplete attempt fragments before merging', () => {
    const accepted = '<html><body><section class="s"><h1>One</h1></section></body></html>';
    const attempt = '<section class="s"><h1>Two</h1></section><section class="s"><h1>broken';
    assert.equal(countSlides(attempt), 2);
    assert.equal(countCompleteSlides(attempt), 1);
    assert.equal(extractCompleteSlides(attempt).length, 1);
    const merged = appendSlides(accepted, extractCompleteSlides(attempt));
    assert.equal(countCompleteSlides(merged), 2);
    assert.match(merged, /<h1>Two<\/h1>/);
    assert.doesNotMatch(merged, /broken/);
});
