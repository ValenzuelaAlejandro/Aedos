const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadStyleSnapshot() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/style-snapshot.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorStyleSnapshot', 'function createEditorStyleSnapshot') +
        '\nmodule.exports = { createEditorStyleSnapshot };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorStyleSnapshot;
}

test('style snapshot preserves the typography fields copied during normalization', () => {
    const computed = {
        fontSize: '32px', fontFamily: 'Arial', color: 'rgb(1, 2, 3)', lineHeight: '40px',
        textAlign: 'center', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
        fontVariant: 'normal', fontStyle: 'italic', textDecoration: 'underline',
    };
    const createEditorStyleSnapshot = loadStyleSnapshot();
    const getInheritedStyles = createEditorStyleSnapshot(element => {
        assert.equal(element.id, 'title');
        return computed;
    });

    assert.deepEqual({ ...getInheritedStyles({ id: 'title' }) }, computed);
});
