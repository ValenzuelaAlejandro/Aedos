const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'frontend', 'scripts', 'app.js'),
    'utf8',
);

function simulatePreviewState({ finalAt, slideAt = 0 }) {
    const classes = new Set(['hidden']);
    let finalPreviewMounted = false;
    const events = [
        ['slide', slideAt],
        ['final', finalAt],
        ['reveal', finalAt + 100],
    ].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

    for (const [event] of events) {
        if (event === 'slide') {
            if (finalPreviewMounted) continue;
            classes.delete('hidden');
            classes.add('is-generating');
        } else if (event === 'final') {
            finalPreviewMounted = true;
            classes.delete('hidden');
            classes.delete('is-generating');
            classes.delete('is-settling');
            classes.add('is-settling');
        } else {
            classes.delete('is-settling');
            classes.add('is-editor-ready');
        }
    }

    return classes;
}

test('fast and slow generation always finish with editor chrome visible', () => {
    for (const finalAt of [0, 100, 500, 670, 1200, 60000]) {
        const classes = simulatePreviewState({ finalAt });
        assert.equal(classes.has('hidden'), false, `hidden at ${finalAt}ms`);
        assert.equal(classes.has('is-generating'), false, `is-generating at ${finalAt}ms`);
        assert.equal(classes.has('is-editor-ready'), true, `chrome missing at ${finalAt}ms`);
    }
});

test('a delayed slide event cannot re-enter streaming after final mount', () => {
    const classes = simulatePreviewState({ finalAt: 100, slideAt: 1500 });
    assert.equal(classes.has('is-generating'), false);
    assert.equal(classes.has('is-editor-ready'), true);
});

test('implementation uses generation events instead of the fixed 670ms race', () => {
    assert.match(appSource, /finalPreviewMounted/);
    assert.match(
        appSource,
        /setPreviewStreamStatus\((?:generationState\.)?proModeEnabled \? 'Analizando contenido…' : 'Generando presentación…'\)/,
    );
    assert.doesNotMatch(appSource, /setTimeout\(\(\) => fn\(\), 670\)/);
});

function simulateStreamingPaints(durationMs, chunkTimes) {
    const loaderVisibleAt = 0;
    const paints = chunkTimes.filter((time) => time < durationMs);
    const finalAt = durationMs;
    return { loaderVisibleAt, paints, finalAt };
}

test('optimistic loader and incremental paints start before 5s and 60s completions', () => {
    for (const durationMs of [5000, 60000]) {
        const { loaderVisibleAt, paints, finalAt } = simulateStreamingPaints(durationMs, [
            80,
            160,
            480,
            1200,
            durationMs - 80,
        ]);
        assert.equal(loaderVisibleAt, 0, `loader did not start immediately for ${durationMs}ms`);
        assert.ok(paints.length > 0, `no incremental paint before ${durationMs}ms completion`);
        assert.ok(paints.every((time) => time < finalAt));
    }
});

test('implementation enters preview before HTML and flushes chunks on a short cadence', () => {
    assert.match(
        appSource,
        /setPreviewStreamStatus\((?:generationState\.)?proModeEnabled \? 'Analizando contenido…' : 'Generando presentación…'\)/,
    );
    assert.match(appSource, /doTransitionToPreview\(\);\s*\/\/ Writing every model token/s);
    assert.match(appSource, /const STREAM_FLUSH_INTERVAL_MS = 80/);
    assert.match(appSource, /schedulePreviewMarkupFlush\(\)/);
});

test('preview zoom retains MobileRuntime preference and width fallback', () => {
    const zoomPath = path.join(
        __dirname,
        '..',
        'src',
        'frontend',
        'features',
        'preview',
        'zoom-controls.js',
    );
    let runtimeMobile = true;
    const window = {
        innerWidth: 1200,
        MobileRuntime: { isMobileLayout: () => runtimeMobile },
        addEventListener: () => {},
    };
    const sandbox = { window, document: { fullscreenElement: null, getElementById: () => null } };
    vm.runInNewContext(fs.readFileSync(zoomPath, 'utf8'), sandbox, { filename: zoomPath });
    const controls = window.AedosPreview.createZoomControls({
        MOBILE_BREAKPOINT: 850,
        resetMobileZoomState: () => {},
    });
    assert.equal(controls.isMobileViewport(), true);
    runtimeMobile = false;
    assert.equal(controls.isMobileViewport(), false);
    window.MobileRuntime = null;
    window.innerWidth = 850;
    assert.equal(controls.isMobileViewport(), true);
    window.innerWidth = 851;
    assert.equal(controls.isMobileViewport(), false);
    controls.resetMobileZoomState();
    assert.equal(window._mobile_zoom, 1);
    assert.equal(window._pan.x, 0);
    assert.equal(window._pan.y, 0);
    let resetCalls = 0;
    window.MobileRuntime = {
        resetZoomState: () => {
            resetCalls += 1;
        },
    };
    controls.resetMobileZoomState();
    assert.equal(resetCalls, 1);
});

test('outline proceed flow keeps backup fallback and hands it to final generation', () => {
    const modulePath = path.join(
        __dirname,
        '..',
        'src',
        'frontend',
        'features',
        'generation',
        'proceed-flow.js',
    );
    const backupSkeleton = { slides: [{ title: 'Saved draft' }] };
    let generatedSkeleton = null;
    let removedClass = null;
    const window = {
        _backupSkeleton: backupSkeleton,
        outlineEditorState: { skeleton: { slides: [] } },
        startFinalGeneration(skeleton) {
            generatedSkeleton = skeleton;
        },
    };
    const document = {
        body: {
            classList: {
                remove(value) {
                    removedClass = value;
                },
            },
        },
        querySelectorAll() {
            return [];
        },
    };
    vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), { window }, { filename: modulePath });
    const handleProceedFlow = window.AedosGeneration.createProceedFlow({ window, document });

    handleProceedFlow({ slides: [] });

    assert.equal(removedClass, 'split-outline-active');
    assert.equal(generatedSkeleton, backupSkeleton);
    assert.equal(window.outlineEditorState.skeleton, backupSkeleton);
    assert.match(appSource, /handleProceedFlow\(finalSkeleton\)/);
});

test('iframe scale helper clears the same inline stage padding fields', () => {
    const scalePath = path.join(
        __dirname,
        '..',
        'src',
        'frontend',
        'features',
        'preview',
        'iframe-scale.js',
    );
    const style = {
        padding: '8px',
        paddingLeft: '1px',
        paddingRight: '2px',
        paddingTop: '3px',
        paddingBottom: '4px',
    };
    const window = {};
    const sandbox = {
        window,
        document: { getElementById: (id) => (id === 'preview-stage' ? { style } : null) },
    };
    vm.runInNewContext(fs.readFileSync(scalePath, 'utf8'), sandbox, { filename: scalePath });
    const scale = window.AedosPreview.createIframeScale({
        previewState: {},
        previewContainer: {},
        syncZoomStateWithViewportMode: () => false,
        updateZoomDisplay: () => {},
        getRefreshSlotOverlays: () => null,
    });
    scale.clearStageInlinePadding();
    assert.deepEqual(style, {
        padding: '',
        paddingLeft: '',
        paddingRight: '',
        paddingTop: '',
        paddingBottom: '',
    });
    sandbox.document.getElementById = () => null;
    assert.doesNotThrow(() => scale.clearStageInlinePadding());
});

test('debug preview title extractor keeps its fallback and title parsing', () => {
    const titlePath = path.join(
        __dirname,
        '..',
        'src',
        'frontend',
        'features',
        'preview',
        'debug-title.js',
    );
    const window = {};
    window.window = window;
    vm.runInNewContext(fs.readFileSync(titlePath, 'utf8'), window, { filename: titlePath });
    const extractTitle = window.AedosPreview.extractDebugCanvasTitle;
    assert.equal(extractTitle('<title>Example</title>'), 'Example');
    assert.equal(extractTitle('', 'Fallback'), 'Fallback');
    assert.equal(extractTitle('<!-- CONFIG {"topic":"From config"} -->'), 'From config');
});

test('iframe mount retains markup repairs, load wiring, and polling cadence', () => {
    const mountPath = path.join(
        __dirname,
        '..',
        'src',
        'frontend',
        'features',
        'preview',
        'iframe-mount.js',
    );
    const window = {};
    const timers = [];
    const writes = [];
    const attributes = [];
    const iframeDocument = {
        body: {},
        readyState: 'loading',
        documentElement: {
            getAttribute: () => 'light',
            setAttribute: (...args) => attributes.push(args),
        },
        open() {},
        write: (html) => writes.push(html),
        close() {},
    };
    const iframe = {
        contentDocument: iframeDocument,
        contentWindow: { document: iframeDocument },
        style: {},
    };
    const previewState = { previewIframe: iframe };
    const sandbox = { window };
    vm.runInNewContext(fs.readFileSync(mountPath, 'utf8'), sandbox, { filename: mountPath });
    const mount = window.AedosPreview.createIframeMount({
        previewState,
        uiLog: { debug() {}, warn() {} },
        document: { documentElement: { getAttribute: () => 'light' } },
        getFindSlides: () => () => [],
        getSetupPreviewInteractions: () => () => {},
        requestAnimationFrame: (callback) => callback(),
        setTimeout: (callback, delay) => timers.push({ callback, delay }),
        getLocalStorage: () => ({ getItem: () => 'dark' }),
    });

    mount(
        '<html><head><link href="https://fonts.googleapis.com/old"></head><body><section></body></html>',
    );
    assert.deepEqual(
        timers.map(({ delay }) => delay),
        [300],
    );
    assert.equal(typeof iframe.onload, 'function');
    assert.match(writes[0], /anti-flicker/);
    assert.match(writes[0], /src="\/editor\/editor\.js\?v=4"/);
    assert.doesNotMatch(writes[0], /fonts\.googleapis\.com\/old/);
    assert.match(writes[0], /<\/body><\/html><\/section>$/);
    assert.deepEqual(attributes, [['data-theme', 'light']]);
});
