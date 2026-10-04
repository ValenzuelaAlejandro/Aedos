const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/frontend/features/chat/attachments.js'), 'utf8');

function element() {
    const classes = new Set();
    const listeners = new Map();
    return {
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name)
        },
        dataset: {},
        style: {},
        children: [],
        addEventListener: (name, callback) => listeners.set(name, callback),
        dispatch: (name, event) => listeners.get(name)(event),
        querySelectorAll: () => [],
        appendChild(child) { this.children.push(child); },
        setAttribute() { },
        set innerHTML(value) { this.children = []; this.html = value; },
        get innerHTML() { return this.html || ''; }
    };
}

test('attachment factory preserves listener order, validation, chips and legacy file state', () => {
    const events = [];
    const alerts = [];
    const preview = element();
    preview.classList.add('hidden');
    const chat = element();
    const overlay = element();
    overlay.classList.add('hidden');
    const chips = element();
    const button = element();
    const input = element();
    const nodes = {
        'preview-container': preview,
        'chat-screen': chat,
        'drag-drop-overlay': overlay
    };
    const document = {
        getElementById: (id) => nodes[id],
        createElement: () => element()
    };
    const window = {
        addEventListener: (name, callback) => events.push([name, callback]),
        __t: (_key, fallback) => fallback,
        _syncModeWithFiles: () => { }
    };
    const context = { window, document, alert: (message) => alerts.push(message), URL, setTimeout };
    vm.runInNewContext(source, context);

    let validations = 0;
    window.AedosAttachments.createPageDropGuard();
    window.AedosAttachments.createAttachments({
        btnAttachFile: button,
        fileUploadInput: input,
        attachmentPreviewContainer: chips,
        validateGenerateButton: () => { validations++; }
    });

    assert.deepEqual(events.map(([name]) => name), ['dragover', 'drop', 'dragenter', 'dragover', 'dragleave', 'drop']);
    const pdf = (name, size = 1) => ({ name, size, type: 'application/pdf' });
    input.dispatch('change', { target: { files: [pdf('one.pdf'), pdf('two.pdf')] } });
    assert.equal(window._attachedFiles.length, 2);
    assert.equal(chips.children.length, 2);
    assert.equal(validations, 1);
    assert.equal(input.value, '');

    input.dispatch('change', { target: { files: [pdf('bad.exe'), pdf('huge.pdf', 10 * 1024 * 1024 + 1)] } });
    assert.equal(window._attachedFiles.length, 2);
    assert.equal(alerts.length, 2);

    input.dispatch('change', { target: { files: [pdf('three.pdf'), pdf('four.pdf')] } });
    assert.equal(window._attachedFiles.length, 3);
    assert.equal(chips.children.length, 3);
    assert.equal(alerts.length, 3);
    chips.children[0].children[1].dispatch('click');
    assert.equal(window._attachedFiles.length, 2);
    assert.equal(chips.children.length, 2);
    assert.equal(validations, 3);
});
