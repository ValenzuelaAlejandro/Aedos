const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'src/frontend/features/outline/slide-renderer.js');
const fixturePath = path.join(root, 'tests/fixtures/frontend/renderers/outline-slide-cases.json');

function createDocument() {
    return {
        createElement(tagName) {
            assert.equal(tagName, 'div');
            return { className: '', dataset: {}, innerHTML: '' };
        },
    };
}

function loadRenderer() {
    const window = {
        escapeHtml(value) {
            if (typeof value !== 'string') return '';
            return value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },
    };
    vm.runInNewContext(fs.readFileSync(rendererPath, 'utf8'), {
        document: createDocument(),
        window,
    }, { filename: rendererPath });
    return window.AedosOutlineRenderer;
}

test('outline slide renderer preserves the legacy markup byte-for-byte', () => {
    const renderer = loadRenderer();
    const [vector] = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const container = {
        children: [],
        set innerHTML(value) {
            if (value === '') this.children = [];
        },
        appendChild(item) {
            this.children.push(item);
        },
    };

    renderer.renderSlides(container, vector.slides);
    assert.equal(container.children.length, vector.expected.length);
    for (const [index, expected] of vector.expected.entries()) {
        const item = container.children[index];
        assert.equal(String(item.dataset.index), expected.dataIndex);
        assert.equal(item.className, expected.className);
        assert.equal(item.innerHTML.length, expected.length);
        assert.equal(crypto.createHash('sha256').update(item.innerHTML).digest('hex'), expected.sha256);
    }
});
