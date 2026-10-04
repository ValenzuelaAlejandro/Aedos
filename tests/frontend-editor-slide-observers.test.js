const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadInstaller() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/slide-observers.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function installEditorSlideObservers', 'function installEditorSlideObservers') +
        '\nmodule.exports = { installEditorSlideObservers };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.installEditorSlideObservers;
}

test('slide observers retain navigation event order and observe existing, added, and active slides', () => {
    const events = [];
    const observers = [];
    const slide = { classList: { contains: name => name === 'active' } };
    const body = {};
    class FakeObserver {
        constructor(callback) { this.callback = callback; this.observations = []; observers.push(this); }
        observe(target, options) { this.observations.push({ target, options }); }
    }
    const document = {
        body,
        documentElement: {},
        querySelectorAll: selector => { assert.equal(selector, 'section.s'); return [slide]; },
    };
    let selected = {};
    const deselect = () => events.push('deselect');

    loadInstaller()({
        document,
        window: { addEventListener: event => events.push(event) },
        MutationObserver: FakeObserver,
        getSelectedElement: () => selected,
        deselect,
    });

    assert.deepEqual(events, ['navigate-prev', 'navigate-next']);
    assert.equal(observers.length, 2);
    assert.equal(observers[0].observations[0].target, slide);
    assert.equal(observers[0].observations[0].options.attributes, true);
    assert.equal(observers[0].observations[0].options.attributeFilter.join(','), 'class');
    assert.equal(observers[1].observations[0].target, body);
    assert.equal(observers[1].observations[0].options.childList, true);
    assert.equal(observers[1].observations[0].options.subtree, true);
    observers[0].callback([{ target: slide }]);
    assert.deepEqual(events, ['navigate-prev', 'navigate-next', 'deselect']);
    selected = null;
    observers[0].callback([{ target: slide }]);
    assert.equal(events.length, 3);
    observers[1].callback([]);
    assert.equal(observers[0].observations.length, 2);
});
