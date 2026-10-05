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
