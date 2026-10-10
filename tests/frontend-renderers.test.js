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
const imageSlotOverlaysPath = path.join(root, 'src/frontend/features/preview/image-slot-overlays.js');
const appDropdownsPath = path.join(root, 'src/frontend/features/app/dropdowns.js');
const slideDiscoveryPath = path.join(root, 'src/frontend/features/preview/slide-discovery.js');
const generationPreviewTransitionPath = path.join(root, 'src/frontend/features/generation/preview-transition.js');

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

test('image-slot overlay system registers its classic API and preserves legacy delay schedule', () => {
    const window = { AedosPreview: {} };
    vm.runInNewContext(fs.readFileSync(imageSlotOverlaysPath, 'utf8'), { window }, {
        filename: imageSlotOverlaysPath,
    });
    assert.equal(typeof window.AedosPreview.createImageSlotOverlaySystem, 'function');
    const source = fs.readFileSync(imageSlotOverlaysPath, 'utf8');
    assert.match(source, /addEventListener\('dblclick'/);
    assert.match(source, /addEventListener\('trigger-image-picker'/);
    assert.match(source, /setTimeout\(positionOverlays, 100\)[\s\S]*setTimeout\(positionOverlays, 500\)[\s\S]*setTimeout\(positionOverlays, 1500\)/);
});

test('app dropdown factory keeps model, mode, language, and export registration order', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync(appDropdownsPath, 'utf8'), { window }, {
        filename: appDropdownsPath,
    });
    assert.equal(typeof window.AedosAppDropdowns.createAppDropdowns, 'function');
    const source = fs.readFileSync(appDropdownsPath, 'utf8');
    const registrations = [
        "modelBtn.addEventListener('click'",
        "modelMenu.addEventListener('click'",
        "langBtn.addEventListener('click'",
        "langMenu.addEventListener('click'",
        "exportMenuBtn.addEventListener('click'",
        "exportMenu.addEventListener('click'",
        "exportPptxBtn.addEventListener('click'",
        "document.addEventListener('click'",
    ].map(token => source.indexOf(token));
    assert.ok(registrations.every(index => index >= 0));
    assert.deepEqual(registrations, [...registrations].sort((a, b) => a - b));
    assert.match(source, /window\._syncModeWithFiles\s*=/);
    assert.match(source, /modeButtons\?\.forEach/);
});

test('slide discovery preserves selector precedence and editor-chrome exclusions', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync(slideDiscoveryPath, 'utf8'), { window }, {
        filename: slideDiscoveryPath,
    });
    const findSlides = window.AedosPreview.createSlideDiscovery();
    const preferred = { id: 'preferred-section' };
    const legacy = { id: 'legacy-class' };
    const selectorCalls = [];
    const doc = {
        body: { children: [] },
        querySelectorAll(selector) {
            selectorCalls.push(selector);
            if (selector === 'section.s') return [preferred];
            if (selector === 'section[class*="slide"]') return [legacy];
            return [];
        },
    };

    const preferredSlides = findSlides(doc);
    assert.equal(preferredSlides.length, 1);
    assert.equal(preferredSlides[0], preferred);
    assert.deepEqual(selectorCalls, ['section.s']);
    assert.equal(findSlides(null).length, 0);

    const makeBodyNode = (tagName, classes = []) => ({
        tagName,
        children: [],
        classList: { contains: name => classes.includes(name) },
    });
    const content = makeBodyNode('MAIN');
    const chrome = makeBodyNode('DIV', ['editor-toolbar']);
    const fallbackDoc = {
        body: { children: [chrome, content] },
        querySelectorAll: () => [],
    };
    const fallbackSlides = findSlides(fallbackDoc);
    assert.equal(fallbackSlides.length, 1);
    assert.equal(fallbackSlides[0], content);
});

test('generation preview transition keeps route, chrome, double-frame, and timer order', () => {
    const window = { location: { hash: '#chat' }, addEventListener: type => events.push(`window.${type}`) };
    vm.runInNewContext(fs.readFileSync(generationPreviewTransitionPath, 'utf8'), { window }, {
        filename: generationPreviewTransitionPath,
    });
    const events = [];
    const classes = name => ({
        add: (...values) => events.push(`${name}.add:${values.join(',')}`),
        remove: (...values) => events.push(`${name}.remove:${values.join(',')}`),
    });
    const chatScreen = { classList: classes('chat'), style: {} };
    const previewHeader = { classList: classes('header') };
    const previewContainer = { classList: classes('preview') };
    const body = { classList: classes('body') };
    const settlingAnimation = { kill: () => events.push('settle.kill') };
    const generation = {};
    const generationState = { activeGeneration: generation };
    let hasTransitioned = false;
    const timers = [];
    const document = {
        body,
        getElementById: id => id === 'preview-wrapper-scrollable' ? { style: {} } : null,
        querySelector: () => null,
    };
    window.navigateToEditor = () => { events.push('navigate'); window.location.hash = '#editor'; };
    const transition = window.AedosGeneration.createGenerationPreviewTransition({
        window, document, generationState, generation, chatScreen, previewHeader,
        previewContainer, previewState: { settlingAnimation },
        getHasTransitioned: () => hasTransitioned,
        setHasTransitioned: value => { hasTransitioned = value; },
        stopBtnMessages: () => events.push('stop-messages'),
        resetMobileZoomState: () => events.push('reset-mobile-zoom'),
        updateZoomDisplay: () => events.push('zoom-display'),
        clearStageInlinePadding: () => events.push('clear-stage-padding'),
        scaleIframe: () => events.push('scale-iframe'),
        requestAnimationFrame: callback => { events.push('raf'); callback(); },
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    });

    transition();
    transition();
    assert.equal(generation.transitionStarted, true);
    assert.equal(events.filter(event => event === 'navigate').length, 1);
    assert.equal(events.filter(event => event === 'raf').length, 2);
    assert.deepEqual(timers.map(timer => timer.delay), [380, 300]);
    assert.ok(events.indexOf('stop-messages') < events.indexOf('navigate'));
    assert.ok(events.indexOf('navigate') < events.indexOf('body.remove:split-outline-active'));
    assert.ok(events.indexOf('clear-stage-padding') < events.indexOf('raf'));
    assert.ok(events.includes('settle.kill'));
    assert.ok(events.includes('window.resize'));
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

test('debug canvas button is available on localhost before the first generation', async () => {
    const buttonListeners = [];
    const calls = [];
    const button = {
        addEventListener: (...args) => buttonListeners.push(args),
        setAttribute: (...args) => calls.push(['setAttribute', ...args]),
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
    const sandbox = { window, document, URLSearchParams };
    vm.runInNewContext(fs.readFileSync(debugCanvasPath, 'utf8'), sandbox, { filename: debugCanvasPath });
    const factory = sandbox.AedosPreview.createDebugCanvas({
        window,
        document,
        fetch: async function (...args) {
            assert.equal(this, window);
            calls.push(['fetch', ...args]);
            return { ok: true, text: async () => '<title>Example</title>' };
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
    assert.equal(fetchCalls().length, 0);
    assert.equal(button.id, 'btn-debug-last-generated');
    assert.equal(buttonListeners[0][0], 'click');
    await buttonListeners[0][1]();
    assert.equal(fetchCalls()[0][2].method, undefined);
    assert.equal(fetchCalls()[0][2].cache, 'no-store');
    assert.deepEqual(calls.find(([kind]) => kind === 'openPreview'), ['openPreview', '<title>Example</title>', 'Example']);
});

test('existing HTML preview writes its title to the legacy input or text label', () => {
    const window = { location: { hash: '#editor' }, innerWidth: 768 };
    const input = { tagName: 'INPUT', value: '' };
    const textLabel = { tagName: 'DIV', textContent: '' };
    let currentLabel = input;
    const makeNode = () => ({ classList: { add: () => {}, remove: () => {} }, style: {} });
    const sandbox = { window, document: {} };
    vm.runInNewContext(fs.readFileSync(debugCanvasPath, 'utf8'), sandbox, { filename: debugCanvasPath });
    const openPreview = sandbox.AedosPreview.createExistingHtmlPreview({
        window,
        document: {
            getElementById: id => id === 'preview-topic-label' ? currentLabel : null,
            body: { classList: { add: () => {} } },
        },
        previewState: {},
        clearPendingTransition: () => {},
        updateZoomDisplay: () => {},
        resultContainer: null,
        errorContainer: null,
        refusedContainer: null,
        previewContainer: makeNode(),
        chatScreen: { ...makeNode(), style: {} },
        resetPreviewSurface: () => {},
        slideLabel: { textContent: '' },
        updateMinimapSkeleton: () => {},
        previewHeader: makeNode(),
        initPreview: () => {},
        getScaleIframe: () => () => {},
    });

    openPreview('<html></html>', 'Input title');
    assert.equal(input.value, 'Input title');
    currentLabel = textLabel;
    openPreview('<html></html>', 'Text title');
    assert.equal(textLabel.textContent, 'Text title');
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
