const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMover() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/arrow-movement.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorArrowMover', 'function createEditorArrowMover') +
        '\nmodule.exports = { createEditorArrowMover };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorArrowMover;
}

test('arrow movement preserves collision resolution, shift distance, undo grouping, and selection refresh', () => {
    const element = {
        style: { left: '10px', top: '20px' },
        closest: () => null,
        getBoundingClientRect: () => ({ width: 30, height: 40 }),
    };
    const slide = {};
    const timers = [];
    const collisionInputs = [];
    let saves = 0;
    let updates = 0;
    const move = loadMover()({
        getSelectedElement: () => element,
        document: { body: slide },
        setTimeout: callback => timers.push(callback),
        saveState: () => saves++,
        resolveDragCollision: (rect, targetSlide, exclude) => {
            collisionInputs.push({ rect, targetSlide, exclude });
            return { left: rect.left + 1, top: rect.top + 2 };
        },
        updateSelectionBox: () => updates++,
    });

    move('ArrowRight', true);
    move('ArrowDown', false);
    assert.equal(element.style.left, '22px');
    assert.equal(element.style.top, '25px');
    assert.equal(saves, 1);
    assert.equal(updates, 2);
    assert.equal(collisionInputs[0].rect.left, 20);
    assert.equal(collisionInputs[0].rect.top, 20);
    assert.equal(collisionInputs[0].rect.width, 30);
    assert.equal(collisionInputs[0].targetSlide, slide);
    assert.equal(collisionInputs[0].exclude, element);
    assert.equal(timers.length, 1);
    timers[0]();
    assert.equal(element._undoSavingArrow, false);
});
