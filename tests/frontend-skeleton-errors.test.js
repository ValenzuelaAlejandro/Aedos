const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function run(events) {
    const errors = [], complete = [], labels = [], drafts = [], state = { targetLanguage: 'fr', proModeEnabled: false };
    const classes = { contains: () => false, remove() {}, add() {} };
    const window = { location: { hash: '#chat' }, outlineEditorState: { skeleton: null },
        AedosCredits: { createRequestId: () => 'turn' },
        AedosCreditsUI: { getSlideCount: () => 8, refresh: async () => {} },
        __t: (_key, fallback) => fallback,
        parsePartialSkeleton: raw => { try { return JSON.parse(raw); } catch (_) { return { slides: [{ title: raw }] }; } },
        renderStreamingOutline: value => { drafts.length = 0; drafts.push(value); },
        prepareOutlineStreaming: () => { drafts.length = 0; window.outlineEditorState.skeleton = null; },
        AedosThinking: { setStatusText: (_body, text) => labels.push(text), resetReasoning() {}, getPanel: () => true,
            appendReasoning() {}, collapseDetails() {}, updateStatus() {}, collapse() {} },
        finalizeStreamingOutline: value => { complete.push(value); window.outlineEditorState.skeleton = value; },
        AedosHttpSse: { openResponse: () => ({ events: (async function* () {
            for (const event of events) {
                if (typeof event === 'function') { event({ labels, drafts, complete, window }); continue; }
                if (event instanceof Error) throw event;
                yield { data: typeof event === 'string' ? event : JSON.stringify(event) };
            }
        })() }) } };
    const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
    vm.runInNewContext(fs.readFileSync('src/frontend/features/generation/retry-status.js', 'utf8'), { window });
    vm.runInNewContext(fs.readFileSync('src/frontend/features/generation/skeleton-generation.js', 'utf8'), { window, console });
    const handle = window.AedosGeneration.createSkeletonGeneration({ window, document, generationState: state,
        generateBtn: { classList: classes }, temaInput: { value: 'Example topic' }, temaError: { classList: classes },
        toggleGenerateLoading() {}, FormData, AbortController,
        fetch: async () => ({ ok: true }), handleProceedFlow() {}, handleSkeletonError: error => errors.push(error) });
    await handle();
    return { errors, complete, labels, drafts };
}

test('a provider SSE error is fatal even when its text misses the old case-sensitive filter', async () => {
    const result = await run([{ chunk: 'partial' }, { error: 'PROVIDER_UNAVAILABLE' }]);
    assert.equal(result.complete.length, 0);
    assert.equal(result.errors[0].message, 'PROVIDER_UNAVAILABLE');
    assert.equal(result.drafts.length, 0);
});

test('clean EOF without done never promotes a partial outline to a complete result', async () => {
    const result = await run([{ chunk: 'partial' }]);
    assert.equal(result.complete.length, 0);
    assert.match(result.errors[0].message, /interrupted/);
});

test('malformed SSE is not swallowed as a JSON console warning', async () => {
    const result = await run(['{broken']);
    assert.equal(result.complete.length, 0);
    assert.match(result.errors[0].message, /interrupted/);
});

test('a complete response is accepted once and late transport errors cannot replace it', async () => {
    const skeleton = { slides: [{ title: 'Complete' }] };
    const result = await run([{ done: true, skeleton }, new Error('late network error')]);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(result.complete)), [skeleton]);
});

test('chat streams a draft live, resets it without history, and restores the output-language status on new content', async () => {
    const old = { language: 'fr', slides: [{ title: 'Failed draft' }] };
    const fresh = { language: 'fr', slides: [{ title: 'Complete reply' }] };
    const result = await run([
        { chunk: JSON.stringify(old) },
        ({ drafts, complete, window }) => {
            assert.equal(drafts[0].slides[0].title, 'Failed draft');
            assert.equal(complete.length, 0);
            assert.equal(window.outlineEditorState.skeleton, null);
        },
        { reset: true },
        ({ drafts, labels }) => { assert.equal(drafts.length, 0); assert.equal(labels.at(-1), 'Nouvelle tentative...'); },
        { reasoning: 'working' },
        ({ labels }) => assert.equal(labels.at(-1), 'Nouvelle tentative...'),
        { chunk: JSON.stringify(fresh) },
        ({ labels }) => assert.equal(labels.at(-1), 'Création du plan…'),
        { done: true, skeleton: fresh }
    ]);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(result.complete)), [fresh]);
});
