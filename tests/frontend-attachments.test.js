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

test('attachment factory disables document input and rejects dropped or selected documents', () => {
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
        _syncModeWithFiles: () => { },
        AedosModals: { showNotice: message => alerts.push(message) },
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

    assert.equal(button.hidden, true);
    assert.equal(input.disabled, true);
    assert.equal(window._attachedFiles.length, 0);

    assert.deepEqual(events.map(([name]) => name), ['dragover', 'drop', 'dragenter', 'dragover', 'dragleave', 'drop']);
    const pdf = (name, size = 1) => ({ name, size, type: 'application/pdf' });
    input.dispatch('change', { target: { files: [pdf('one.pdf'), pdf('two.pdf')] } });
    assert.equal(window._attachedFiles.length, 0);
    assert.equal(chips.children.length, 0);
    assert.equal(validations, 0);
    assert.equal(input.value, '');
    assert.equal(alerts.length, 1);
    const dropHandler = events.find(([name]) => name === 'drop')[1];
    dropHandler({ preventDefault() {}, dataTransfer: { files: [pdf('drop.pdf')] } });
    assert.equal(window._attachedFiles.length, 0);
});
