const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadChatInput() {
    const window = { _attachedFiles: [], __t: (key) => ({ hero_active: 'Active', hero_line_1: 'Idle' })[key] || key };
    const sourcePath = path.join(__dirname, '../src/frontend/features/chat/input-controller.js');
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), { window }, { filename: sourcePath });
    return window.AedosChatInput;
}

test('generate validator preserves topic/file thresholds and hero state transitions', () => {
    const chatInput = loadChatInput();
    const state = { heroCustomTextActive: false };
    const titles = [];
    let value = '';
    let generating = false;
    const window = { _attachedFiles: [], __t: (key) => key };
    const btnGenerate = { disabled: true, classList: { contains: () => generating } };
    const validate = chatInput.createGenerateButtonValidator({
        btnGenerate,
        temaInput: { get value() { return value; } },
        generationState: state,
        window,
        getAnimateHeroTitle: () => (title) => titles.push(title),
    });

    validate();
    assert.equal(btnGenerate.disabled, true);
    value = 'abc';
    validate();
    assert.equal(btnGenerate.disabled, true);
    value = 'abcd';
    validate();
    assert.equal(btnGenerate.disabled, false);
    assert.equal(state.heroCustomTextActive, true);
    assert.deepEqual(titles, ['hero_active']);
    validate();
    assert.deepEqual(titles, ['hero_active']);
    value = '';
    validate();
    assert.equal(state.heroCustomTextActive, false);
    assert.deepEqual(titles, ['hero_active', 'hero_line_1']);
    value = '';
    window._attachedFiles.push({ name: 'file.pdf' });
    validate();
    assert.equal(btnGenerate.disabled, false);
    generating = true;
    btnGenerate.disabled = false;
    validate();
    assert.equal(btnGenerate.disabled, false);
});

test('fillInput retains translation, entity decoding, focus, and input dispatch', () => {
    const chatInput = loadChatInput();
    const calls = [];
    const input = { value: '', focus: () => calls.push('focus'), dispatchEvent: (event) => calls.push(event.type) };
    const window = { __t: (key) => key === 'topic-key' ? 'A &amp; B' : key };
    chatInput.registerFillInput({
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
