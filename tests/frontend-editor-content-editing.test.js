const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContentEditing() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/content-editing.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorPasteHandler', 'function createEditorPasteHandler')
        .replace('export function createEditorTextEditingHandler', 'function createEditorTextEditingHandler') +
        '\nmodule.exports = { createEditorPasteHandler, createEditorTextEditingHandler };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports;
}

test('paste inserts plain text and prevents rich clipboard insertion', () => {
    const inserted = [];
    const target = { closest: () => target };
    const { createEditorPasteHandler } = loadContentEditing();
    const handler = createEditorPasteHandler({
        document: { execCommand: (...args) => inserted.push(args) },
        window: {},
    });
    const event = {
        target,
        clipboardData: { getData: type => type === 'text/plain' ? 'plain text' : '' },
        preventDefault() { this.prevented = true; },
    };

    handler(event);
    assert.deepEqual(inserted[0], ['insertText', false, 'plain text']);
    assert.equal(event.prevented, true);
});

test('editing selected text enters contenteditable and restores selection UI on blur', () => {
    const calls = [];
    const blurHandlers = [];
    const selectedElement = {
        _normalized: true,
        dataset: {},
        style: { position: 'relative' },
        addEventListener: (type, handler) => { if (type === 'blur') blurHandlers.push(handler); },
        removeEventListener: () => {},
        closest: () => null,
        focus: () => calls.push('focus'),
    };
    const classValues = new Set();
    const selectionBox = {
        style: {},
        classList: {
            add: value => classValues.add(value),
            remove: value => classValues.delete(value),
        },
    };
    const selection = { removeAllRanges: () => calls.push('clear'), addRange: () => calls.push('select') };
    const { createEditorTextEditingHandler } = loadContentEditing();
    const handler = createEditorTextEditingHandler({
        document: { body: {}, createRange: () => ({ selectNodeContents: () => calls.push('select-contents') }) },
        window: { getSelection: () => selection },
        CustomEvent: function CustomEvent() {},
        selectionBox,
        getSelectedElement: () => selectedElement,
        getIsLocked: () => false,
        isTextEditableElement: () => true,
        normalizeElement: () => { throw new Error('already normalized'); },
        textEditableSelectors: 'p',
        saveState: () => calls.push('save'),
        selectElement: element => calls.push(['reselect', element]),
    });

    handler({ stopPropagation() {} });
    assert.equal(selectedElement.contentEditable, 'true');
    assert.equal(selectionBox.style.pointerEvents, 'none');
    assert.equal(classValues.has('editor-editing-text'), true);
    blurHandlers[0]();
    assert.equal(selectedElement.contentEditable, 'false');
    assert.equal(selectionBox.style.pointerEvents, 'auto');
    assert.equal(classValues.has('editor-editing-text'), false);
    assert.equal(calls.includes('save'), true);
    assert.equal(calls.at(-1)[0], 'reselect');
});
