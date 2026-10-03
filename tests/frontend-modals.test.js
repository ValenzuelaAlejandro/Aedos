const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const modalPath = path.join(root, 'src/frontend/features/modals/error-modal.js');

function loadModalModule() {
    const scheduled = [];
    const window = {
        setTimeout(callback, delay) {
            scheduled.push({ callback, delay });
            return scheduled.length;
        }
    };
    vm.runInNewContext(fs.readFileSync(modalPath, 'utf8'), { window }, { filename: modalPath });
    return { window, scheduled };
}

function createContainer() {
    const classes = new Set(['hidden']);
    return {
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name)
        }
    };
}

test('error modal keeps the 190ms closing transition and callback timing', () => {
    const { window, scheduled } = loadModalModule();
    const container = createContainer();
    const modal = window.AedosModals.createErrorModal(container);
    let dismissed = 0;

    modal.show(() => { dismissed++; });
    assert.equal(container.classList.contains('hidden'), false);
    modal.dismiss();
    assert.equal(container.classList.contains('is-closing'), true);
    assert.equal(dismissed, 1);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 190);

    scheduled[0].callback();
    assert.equal(container.classList.contains('is-closing'), false);
    assert.equal(container.classList.contains('hidden'), true);
    modal.clearOnDismiss();
});
