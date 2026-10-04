const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCollisionGeometry() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/collision-geometry.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function resolveDragCollision', 'function resolveDragCollision')
        .replace('export function resolveResizeCollision', 'function resolveResizeCollision') +
        '\nmodule.exports = { resolveDragCollision, resolveResizeCollision };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports;
}

test('drag collision preserves the proposed slide coordinates', () => {
    const geometry = loadCollisionGeometry();
    const proposed = { left: 42, top: 73, width: 80, height: 50 };

    assert.deepEqual({ ...geometry.resolveDragCollision(proposed, {}, null) }, { left: 42, top: 73 });
});

test('resize collision leaves dimensions above the 20px minimum unchanged', () => {
    const geometry = loadCollisionGeometry();
    const proposed = { left: 40, top: 30, width: 80, height: 50 };

    assert.deepEqual({ ...geometry.resolveResizeCollision(proposed, 'se', {}, null) }, proposed);
});

test('west and north resize handles preserve their anchored edges at minimum size', () => {
    const geometry = loadCollisionGeometry();
    const proposed = { left: 45, top: 35, width: 10, height: 8 };

    assert.deepEqual({ ...geometry.resolveResizeCollision(proposed, 'nw', {}, null, {
        fixedRight: 60,
        fixedBottom: 50,
    }) }, { left: 40, top: 30, width: 20, height: 20 });
});
