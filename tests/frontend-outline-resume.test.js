const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const modulePath = path.join(__dirname, '../src/frontend/features/outline/resume.js');

test('outline resume restores live draft, controls, hero state, and timer accessors', () => {
    const calls = [];
    const classList = { add: value => calls.push(`add:${value}`), remove: value => calls.push(`remove:${value}`) };
    const hero = {
        textContent: 'Old hero',
        parentElement: { classList },
        getAttribute: () => null,
        setAttribute: (...args) => calls.push(['attribute', ...args]),
    };
    const edgeTab = { classList, querySelector: () => ({ textContent: '' }) };
    const ids = { 'outline-empty-state': { classList }, 'outline-backdrop': { classList }, 'outline-edge-tab': edgeTab };
    const document = {
        querySelector: selector => selector === '.hero-title-text' ? hero : selector === '.hero-title' ? {} : null,
        getElementById: id => ids[id] || null,
    };
    const state = { skeleton: null, isLoading: true };
    const timers = { _heroTypewriterTimer: 1, _heroResetTimer: 2, _btnMsgTimer: 3 };
    const gsap = { killTweensOf: () => calls.push('kill'), set: (...args) => calls.push(['gsap', ...args]) };
    const global = { clearTimeout: id => calls.push(`clear:${id}`) };
    vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), { window: global }, { filename: modulePath });
    global.AedosOutlineResume.resumeOutlineEditor({
        document,
        getState: () => state,
        applyTranslations: () => calls.push('translate-all'),
        syncCustomDropdowns: () => calls.push('sync-dropdowns'),
        getActiveOutlineContainer: () => ({ classList }),
        getTimer: name => timers[name],
        setTimer: (name, value) => { timers[name] = value; },
        clearTimeout: id => global.clearTimeout(id),
        getGsap: () => gsap,
        translate: (key, fallback) => `${key}:${fallback}`,
    });

    assert.deepEqual(JSON.parse(JSON.stringify(state.skeleton)), { slides: [] });
    assert.equal(hero.textContent, 'generating_outline:Generating structure...');
    assert.equal(hero.getAttribute('data-original-text'), null);
    assert.deepEqual(timers, { _heroTypewriterTimer: null, _heroResetTimer: null, _btnMsgTimer: null });
    assert.deepEqual(calls.filter(call => typeof call === 'string' && (call.startsWith('clear:') || call.startsWith('translate') || call.startsWith('sync') || call.startsWith('kill'))), [
        'translate-all', 'sync-dropdowns', 'clear:1', 'clear:2', 'clear:3', 'kill',
    ]);
});
