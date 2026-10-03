const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'src/frontend/features/outline/slide-renderer.js');
const parserPath = path.join(root, 'src/frontend/features/outline/stream-parser.js');
const bindingsPath = path.join(root, 'src/frontend/features/outline/editor-bindings.js');
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

test('outline stream parser preserves complete and partial slide fragments', () => {
    const window = {};
    vm.runInNewContext(fs.readFileSync(parserPath, 'utf8'), { window }, { filename: parserPath });
    const parse = window.AedosOutlineParser.parsePartialSkeleton;

    const complete = parse('{"slides":[{"index":0,"title":"Solar","key_points":["Clean","Reliable"]}]}');
    assert.equal(JSON.stringify(complete), JSON.stringify({ slides: [{ title: 'Solar', key_points: ['Clean', 'Reliable'] }] }));

    const partial = parse('{"slides":[{"index":0,"title":"Still typ');
    assert.equal(JSON.stringify(partial), JSON.stringify({ slides: [{ title: 'Still typ', key_points: [] }] }));
});

test('outline editor bindings update the live slide through the injected getter', () => {
    const listeners = {};
    const titleInput = {
        dataset: { index: '0' },
        style: {},
        scrollHeight: 24,
        value: 'Edited title',
        addEventListener(type, listener) { listeners[type] = listener; },
    };
    const document = {
        querySelectorAll(selector) {
            return selector === '.outline-slide-title' ? [titleInput] : [];
        },
    };
    const window = {};
    vm.runInNewContext(fs.readFileSync(bindingsPath, 'utf8'), {
        window,
        document,
        clearTimeout() {},
        setTimeout(callback) { callback(); return 1; },
    }, { filename: bindingsPath });

    const slides = [{ title: 'Original title', key_points: [] }];
    let updateCountCalls = 0;
    window.AedosOutlineEditorBindings.bindEvents({
        getSlides: () => slides,
        renderSlides() {},
        updateSlideCount() { updateCountCalls++; },
    });
    listeners.input({ target: titleInput });

    assert.equal(slides[0].title, 'Edited title');
    assert.equal(updateCountCalls, 1);
});
