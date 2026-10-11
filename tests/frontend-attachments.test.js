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
        setAttribute(name, value) { this[name] = value; },
        removeAttribute(name) { delete this[name]; },
        set innerHTML(value) { this.children = []; this.html = value; },
        get innerHTML() { return this.html || ''; }
    };
}

test('attachments follow Gemini quota, preserve incompatible files, and offer removal', () => {
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
    const warning = element();
    const warningText = element();
    const removeAll = element();
    const buttonWrap = element();
    const generate = element();
    warning.hidden = true;
    const nodes = {
        'preview-container': preview,
        'chat-screen': chat,
        'drag-drop-overlay': overlay,
        'attachment-model-warning': warning,
        'attachment-model-warning-text': warningText,
        'remove-incompatible-files': removeAll,
        'attach-button-wrap': buttonWrap,
        'btn-generate': generate,
    };
    const document = {
        getElementById: (id) => nodes[id],
        createElement: () => element()
    };
    let geminiAvailable = true;
    const window = {
        addEventListener: (name, callback) => events.push([name, callback]),
        __t: (key, fallback) => ({
            'credits.attachmentsGeminiOnly': 'Gemini only while quota remains',
            'credits.removeAttachments': 'Remove files',
        })[key] || fallback,
        AedosCreditsUI: { canAttachDocuments: () => geminiAvailable },
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

    assert.equal(button.disabled, false);
    assert.equal(input.disabled, false);
    assert.equal(window._attachedFiles.length, 0);

    assert.deepEqual(events.map(([name]) => name), ['dragover', 'drop', 'aedos:language-changed', 'dragenter', 'dragover', 'dragleave', 'drop']);
    const pdf = (name, size = 1) => ({ name, size, type: 'application/pdf' });
    input.dispatch('change', { target: { files: [pdf('one.pdf'), pdf('two.pdf')] } });
    assert.equal(window._attachedFiles.length, 2);
    assert.equal(chips.children.length, 2);
    assert.equal(warning.hidden, true);
    assert(validations > 0);
    assert.equal(input.value, '');
    geminiAvailable = false;
    window.AedosAttachments.refreshAvailability();
    assert.equal(button.disabled, true);
    assert.equal(input.disabled, true);
    assert.equal(warning.hidden, false);
    assert.equal(window.AedosAttachments.hasBlockingAttachments(), true);
    assert.equal(window._attachedFiles.length, 2);
    const dropHandler = events.filter(([name]) => name === 'drop').at(-1)[1];
    dropHandler({ preventDefault() {}, dataTransfer: { files: [pdf('drop.pdf')] } });
    assert.equal(window._attachedFiles.length, 2);
    removeAll.dispatch('click');
    assert.equal(window._attachedFiles.length, 0);
    assert.equal(warning.hidden, true);
    assert.equal(window.AedosAttachments.hasBlockingAttachments(), false);
    assert.equal(alerts.length, 0);
});
