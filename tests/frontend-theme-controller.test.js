const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const controllerPath = path.join(root, 'src/frontend/features/shared/theme-controller.js');

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function createHarness({ savedTheme = null, transitions = true, previewDocument = {} } = {}) {
    const attributes = new Map();
    const classes = new Set();
    const listeners = new Map();
    const stored = new Map(savedTheme ? [['app_theme', savedTheme]] : []);
    const animations = [];
    const ready = deferred();
    const finished = deferred();
    const buttons = new Map();
    for (const id of ['theme-toggle-btn', 'preview-theme-toggle-btn']) {
        buttons.set(id, {
            setAttribute(name, value) { this[name] = value; },
            addEventListener(name, callback) { listeners.set(id, callback); },
        });
    }
    const rootElement = {
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: (name) => attributes.get(name) || null,
        animate(...args) { animations.push(args); },
    };
    const document = {
        documentElement: rootElement,
        getElementById: (id) => buttons.get(id) || null,
    };
    if (transitions) {
        document.startViewTransition = (callback) => {
            callback();
            return { ready: ready.promise, finished: finished.promise };
        };
    }
    const window = {
        innerWidth: 1000,
        innerHeight: 800,
        __t: (key) => `translated:${key}`,
    };
    const localStorage = {
        getItem: (key) => stored.get(key) || null,
        setItem: (key, value) => stored.set(key, value),
    };
    const previewIframe = {
        contentDocument: previewDocument,
    };

    vm.runInNewContext(fs.readFileSync(controllerPath, 'utf8'), { window, document, localStorage }, { filename: controllerPath });
    return { window, document, rootElement, attributes, classes, listeners, stored, animations, ready, finished, previewIframe };
}

test('theme controller restores storage and animates the same root and preview theme', async () => {
    const previewRoot = { setAttribute(name, value) { this[name] = value; } };
    const harness = createHarness({ savedTheme: 'light', previewDocument: { documentElement: previewRoot } });
    harness.window.AedosThemeController.initialize({ previewIframe: harness.previewIframe });

    assert.equal(harness.attributes.get('data-theme'), 'light');
    assert.equal(previewRoot['data-theme'], 'light');
    assert.ok(harness.listeners.get('theme-toggle-btn'));
    harness.listeners.get('theme-toggle-btn')({ clientX: 100, clientY: 200 });

    assert.equal(harness.attributes.get('data-theme'), 'dark');
    assert.equal(harness.stored.get('app_theme'), 'dark');
    assert.equal(previewRoot['data-theme'], 'dark');
    assert.equal(harness.classes.has('theme-transitioning'), true);
    harness.ready.resolve();
    await Promise.resolve();
    assert.equal(harness.animations.length, 1);
    assert.deepEqual(Array.from(harness.animations[0][0].clipPath), [
        'circle(0px at 100px 200px)',
        `circle(${Math.hypot(900, 600) + 60}px at 100px 200px)`,
    ]);
    assert.equal(harness.animations[0][1].duration, 700);
    assert.equal(harness.animations[0][1].pseudoElement, '::view-transition-new(root)');
    harness.finished.resolve();
    await Promise.resolve();
    assert.equal(harness.classes.has('theme-transitioning'), false);
});

test('theme controller defaults to dark and preview toggle tolerates an unavailable iframe', () => {
    const harness = createHarness({ transitions: false });
    harness.previewIframe.contentDocument = null;
    Object.defineProperty(harness.previewIframe, 'contentWindow', {
        get() { throw new Error('cross-origin'); },
    });
    harness.window.AedosThemeController.initialize({ previewIframe: harness.previewIframe });

    assert.equal(harness.attributes.get('data-theme'), 'dark');
    harness.listeners.get('preview-theme-toggle-btn')({ clientX: 0, clientY: 0 });
    assert.equal(harness.attributes.get('data-theme'), 'light');
    assert.equal(harness.stored.get('app_theme'), 'light');
    assert.equal(harness.animations.length, 0);
});
