const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'src/frontend/features/chat/attachment-renderer.js');
const fixturePath = path.join(root, 'tests/fixtures/frontend/renderers/attachment-chip-cases.json');
const contentUtilsPath = path.join(root, 'src/frontend/features/shared/content-utils.js');
const debugCanvasPath = path.join(root, 'src/frontend/features/preview/debug-canvas.js');
const resetControllerPath = path.join(root, 'src/frontend/features/app/reset-controller.js');
const errorPresenterPath = path.join(root, 'src/frontend/features/generation/error-presenter.js');

test('generation error presenter preserves message, cleanup, and modal callback', () => {
    const classes = [];
    const title = { textContent: '' };
    const subtitle = { textContent: '' };
    const message = { textContent: '' };
    let modalCallback;
    let closed = false;
    const window = {
        __t: (_key, fallback) => fallback,
        navigateToHome: () => {},
    };
    const document = {
        body: { classList: { remove: value => classes.push(['body', value]) } },
        getElementById: id => ({
            't-error-title': title,
            't-error-subtitle': subtitle,
            'btn-outline-generate': null,
            'chat-thinking': null,
        })[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
    };
    vm.runInNewContext(fs.readFileSync(errorPresenterPath, 'utf8'), { window }, {
        filename: errorPresenterPath,
    });
    const presenter = window.AedosGeneration.createErrorPresenter({
        window,
        document,
        uiLog: { error: () => {} },
        errorMessage: message,
        previewContainer: { classList: { remove: (...values) => classes.push(['preview', ...values]) } },
        chatScreen: { style: { cssText: 'transition: opacity 1s' }, classList: { remove: value => classes.push(['chat', value]) } },
        showErrorModal: callback => { modalCallback = callback; },
        clearInterval: () => {},
    });
    presenter(new Error('test generation failure'), { close: () => { closed = true; } }, false);
    assert.equal(title.textContent, "Something didn't go as planned");
    assert.equal(subtitle.textContent, 'The AI service is temporarily unavailable. This is usually resolved quickly.');
    assert.equal(message.textContent, 'test generation failure');
    assert.equal(closed, true);
    assert.equal(classes.some(entry => entry[0] === 'chat' && entry[1] === 'hidden'), true);
    assert.equal(typeof modalCallback, 'function');
});

function loadRenderer() {
    const window = {};
    vm.runInNewContext(fs.readFileSync(rendererPath, 'utf8'), { window }, { filename: rendererPath });
    return window;
}

test('chat attachment chips remain byte-identical to the legacy renderer cases', () => {
    const window = loadRenderer();
    const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    for (const vector of cases) {
        const html = window.AedosChatRenderer.renderFileChip(vector.file);
        assert.equal(html.length, vector.length, vector.file.name);
        assert.equal(crypto.createHash('sha256').update(html).digest('hex'), vector.sha256, vector.file.name);
    }
});

test('shared escaping keeps the classic global and exact entity mapping', () => {
    const window = loadRenderer();
    assert.equal(window.escapeHtml('<tag & "quote" \'single\'>'), '&lt;tag &amp; &quot;quote&quot; &#039;single&#039;&gt;');
    assert.equal(window.escapeHtml(42), '');
    assert.equal(window.escapeHtml(null), '');
});

test('content utilities preserve sanitization output and GIF compatibility globals', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync(contentUtilsPath, 'utf8'), {
        window,
        FileReader: function FileReader() {},
        URL: {},
        Image: function Image() {},
        document: {},
    }, { filename: contentUtilsPath });
    const input = '<div onclick="x()"><script>alert(1)</script><link href="x">ok</div>';
    assert.equal(window.AedosContentUtils.sanitizeModelOutput(input), '<div>ok</div>');
    assert.equal(window.sanitizeModelOutput, window.AedosContentUtils.sanitizeModelOutput);
    assert.equal(window.gifToStaticDataUrl, window.AedosContentUtils.gifToStaticDataUrl);
    assert.equal(window.AedosContentUtils.sanitizeModelOutput(null), null);
});

test('app tooltips preserve delegated listener order and viewport placement', () => {
    const tooltipPath = path.join(root, 'src/frontend/features/app/tooltips.js');
    const listeners = [];
    const classes = new Set();
    const tip = {
        style: {},
        offsetWidth: 80,
        offsetHeight: 30,
        classList: {
            add: value => classes.add(value),
            remove: value => classes.delete(value),
        },
    };
    const window = { innerWidth: 400, innerHeight: 300 };
    vm.runInNewContext(fs.readFileSync(tooltipPath, 'utf8'), {
        window,
        document: {
            getElementById: id => id === 'js-tooltip' ? tip : null,
            addEventListener: (...args) => listeners.push(args),
        },
    }, { filename: tooltipPath });
    window.AedosAppTooltips.initialize();
    assert.deepEqual(listeners.map(([type, , capture]) => [type, capture]), [
        ['mouseover', undefined], ['mouseout', undefined], ['mousedown', undefined], ['scroll', true],
    ]);
    const trigger = {
        dataset: { tooltip: 'help' },
        disabled: false,
        classList: { contains: () => false },
        getBoundingClientRect: () => ({ top: 100, bottom: 120, left: 100, width: 30 }),
    };
    listeners[0][1]({ target: { closest: () => trigger } });
    assert.equal(tip.textContent, 'help');
    assert.equal(tip.style.top, '130px');
    assert.equal(tip.style.left, '75px');
    assert.equal(classes.has('visible'), true);
    listeners[1][1]({ target: { closest: () => trigger } });
    assert.equal(classes.has('visible'), false);
});

test('debug canvas factory keeps localhost gating, endpoint order, and button behavior', async () => {
    const buttonListeners = [];
    const calls = [];
    const button = {
        addEventListener: (...args) => buttonListeners.push(args),
    };
    const attachButton = {
        parentElement: { insertBefore: (...args) => calls.push(['insertBefore', ...args]) },
    };
    const window = { location: { hostname: 'localhost', search: '', hash: '#chat' } };
    const document = {
        body: { classList: { remove: (...args) => calls.push(['body.remove', ...args]) } },
        createElement: () => button,
        getElementById: id => id === 'btn-attach-file' ? attachButton : null,
    };
    const sandbox = { window, document };
    vm.runInNewContext(fs.readFileSync(debugCanvasPath, 'utf8'), sandbox, { filename: debugCanvasPath });
    const factory = sandbox.AedosPreview.createDebugCanvas({
        window,
        document,
        fetch: async (...args) => {
            calls.push(['fetch', ...args]);
            return calls.filter(([kind]) => kind === 'fetch').length === 1
                ? { ok: true }
                : { ok: true, text: async () => '<title>Example</title>' };
        },
        previewContainer: null,
        chatScreen: null,
        errorContainer: null,
        errorMessage: null,
        showErrorModal: () => {},
        resetUI: () => {},
        extractTitle: () => 'Example',
        openPreview: (...args) => calls.push(['openPreview', ...args]),
    });

    await factory.initialize();
    const fetchCalls = () => calls.filter(([kind]) => kind === 'fetch');
    assert.equal(fetchCalls()[0][2].method, 'HEAD');
    assert.equal(fetchCalls()[0][2].cache, 'no-store');
    assert.equal(button.id, 'btn-debug-last-generated');
    assert.equal(buttonListeners[0][0], 'click');
    await buttonListeners[0][1]();
    assert.equal(fetchCalls()[1][2].method, undefined);
    assert.equal(fetchCalls()[1][2].cache, 'no-store');
    assert.deepEqual(calls.find(([kind]) => kind === 'openPreview'), ['openPreview', '<title>Example</title>', 'Example']);
});

test('reset controller clears the same live preview state and restarts the empty composer', () => {
    const window = {};
    const sandbox = { window };
    vm.runInNewContext(fs.readFileSync(resetControllerPath, 'utf8'), sandbox, { filename: resetControllerPath });
    const calls = [];
    const makeNode = () => ({
        classList: { add: (...values) => calls.push(['add', ...values]), remove: (...values) => calls.push(['remove', ...values]) },
        style: {},
    });
    const previewState = { currentSlide: 4, totalSlides: 5, generatedHtml: 'html', slideContainer: {} };
    const slideDots = { innerHTML: 'dots' };
    const mobileSlideDots = { innerHTML: 'mobile dots' };
    const mobileSlideLabel = { textContent: '4 / 5' };
    const progressBarEl = { style: { transition: 'width 1s', width: '50%' } };
    const document = {
        body: { classList: { remove: (...args) => calls.push(['body.remove', ...args]) } },
        querySelectorAll: selector => [{ remove: () => calls.push(['remove-node', selector]) }],
        getElementById: () => ({ value: '' }),
    };
    const reset = sandbox.AedosAppReset.createResetController({
        document,
        errorModal: { clearOnDismiss: () => calls.push(['modal.clear']) },
        resultContainer: makeNode(),
        errorContainer: makeNode(),
        refusedContainer: makeNode(),
        previewContainer: makeNode(),
        chatScreen: { ...makeNode(), style: { cssText: 'opacity: 0' } },
        previewState,
        clearSlotOverlays: () => calls.push(['overlays.clear']),
        slideDots,
        mobileSlideDots,
        mobileSlideLabel,
        progressBarEl,
        chatState: { chatPlaceholderContainer: { style: {} } },
        startTypewriter: () => calls.push(['typewriter.start']),
    });

    reset();
    assert.deepEqual(previewState, { currentSlide: 0, totalSlides: 0, generatedHtml: '', slideContainer: null });
    assert.equal(slideDots.innerHTML, '');
    assert.equal(mobileSlideDots.innerHTML, '');
    assert.equal(mobileSlideLabel.textContent, '1 / 1');
    assert.equal(progressBarEl.style.width, '0%');
    assert.equal(calls[0][0], 'body.remove');
    assert.equal(calls.some(([kind]) => kind === 'typewriter.start'), true);
});
