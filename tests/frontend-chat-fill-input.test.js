const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('fillInput preserves translation, entity decoding, focus, and input dispatch', () => {
    const calls = [];
    const input = { value: '', focus: () => calls.push('focus'), dispatchEvent: (event) => calls.push(event.type) };
    const window = { __t: (key) => key === 'topic-key' ? 'A &amp; B' : key };
    const sourcePath = path.join(__dirname, '../src/frontend/features/chat/input-controller.js');
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), { window }, { filename: sourcePath });
    window.AedosChatInput.registerFillInput({
        window,
        Event: class { constructor(type) { this.type = type; } },
        document: {
            getElementById: () => input,
            createElement: () => ({
                set innerHTML(value) { this.value = value.replace('&amp;', '&'); },
                value: '',
            }),
        },
    });

    window.fillInput('topic-key');
    assert.equal(input.value, 'A & B');
    assert.deepEqual(calls, ['focus', 'input']);
    window.fillInput('literal');
    assert.equal(input.value, 'literal');
});

test('suggestion pills preserve translated topic selection and bubbling input order', () => {
    const calls = [];
    const input = { value: '', focus: () => calls.push('focus'), dispatchEvent: (event) => calls.push(event) };
    const listeners = [];
    const pills = [
        { dataset: { topicKey: 'translated', topic: 'fallback' }, addEventListener: (type, handler) => listeners.push({ type, handler }) },
        { dataset: { topic: 'literal topic' }, addEventListener: (type, handler) => listeners.push({ type, handler }) },
    ];
    const window = { __t: (key, fallback) => `${key}:${fallback}` };
    const sourcePath = path.join(__dirname, '../src/frontend/features/chat/input-controller.js');
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), { window }, { filename: sourcePath });
    window.AedosChatInput.registerSuggestionPills({
        document: { querySelectorAll: () => pills, getElementById: () => input },
        window,
        Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } },
    });

    listeners[0].handler();
    assert.equal(listeners[0].type, 'click');
    assert.equal(input.value, 'translated:fallback');
    assert.equal(calls[0], 'focus');
    assert.equal(calls[1].type, 'input');
    assert.equal(calls[1].bubbles, true);
    listeners[1].handler();
    assert.equal(input.value, 'literal topic');
});
