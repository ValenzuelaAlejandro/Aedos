const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadHistoryFactory() {
    const body = {
        innerHTML: '<section>one</section>',
        cloneNode() {
            return {
                innerHTML: body.innerHTML,
                querySelectorAll() {
                    return [];
                },
            };
        },
        querySelector() {
            return null;
        },
    };
    const events = [];
    const window = {
        parent: { currentSlide: 0 },
        dispatchEvent(event) {
            events.push(event);
        },
        lucide: null,
    };
    const document = {
        body,
        querySelectorAll() {
            return [];
        },
    };
    class CustomEvent {
        constructor(type, options) {
            this.type = type;
            this.detail = options.detail;
        }
    }

    const context = { window, document, CustomEvent, setTimeout };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/history.js');
    vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });

    return {
        api: window.AedosEditorHistory,
        body,
        events,
        window,
    };
}

test('editor history preserves duplicate suppression and undo/redo restoration', async () => {
    const { api, body, events, window } = loadHistoryFactory();
    assert.equal(typeof api?.create, 'function');
    assert.equal(window.AedosEditorHistory, api);

    let isRestoring = false;
    const deselections = [];
    let ensured = 0;
    const history = api.create({
        getIsRestoring: () => isRestoring,
        setIsRestoring: (value) => {
            isRestoring = value;
        },
        deselectGroup: (silent) => deselections.push(silent),
        ensureUI: () => {
            ensured++;
        },
    });

    history.saveState();
    history.saveState();
    body.innerHTML = '<section>two</section>';
    history.saveState();

    history.undo();
    assert.equal(body.innerHTML, '<section>one</section>');
    assert.equal(isRestoring, true);
    assert.equal(events[0]?.type, 'state-restored');
    assert.equal(events[0]?.detail?.needsOverlayRebuild, true);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(isRestoring, false);
    assert.deepEqual(deselections, [true, undefined]);
    assert.equal(ensured, 1);

    history.redo();
    assert.equal(body.innerHTML, '<section>two</section>');
    assert.equal(events[1]?.type, 'state-restored');
});
