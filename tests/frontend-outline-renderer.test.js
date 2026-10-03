const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const rendererPath = path.join(root, 'src/frontend/features/outline/slide-renderer.js');
const parserPath = path.join(root, 'src/frontend/features/outline/stream-parser.js');
const chipsPath = path.join(root, 'src/frontend/features/outline/chips-renderer.js');
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

test('outline chips renderer preserves translated actions, delay, and animation order', () => {
    const timeouts = [];
    const window = {
        clearTimeout(timeout) {
            this.clearedTimeout = timeout;
        },
        setTimeout(callback, delay) {
            timeouts.push({ callback, delay });
            return timeouts.length;
        },
        document: {
            body: { contains: () => true },
            createElement(tagName) {
                assert.equal(tagName, 'button');
                return {
                    addEventListener(eventName, callback) {
                        this.eventName = eventName;
                        this.onClick = callback;
                    },
                };
            },
        },
    };
    vm.runInNewContext(fs.readFileSync(chipsPath, 'utf8'), { window }, { filename: chipsPath });
    const container = {
        children: [],
        set innerHTML(value) {
            if (value === '') this.children = [];
        },
        appendChild(button) {
            this.children.push(button);
        },
    };
    const animationOrder = [];
    const translated = [];
    const generated = [];
    let rememberedTimeout;

    window.AedosOutlineChipsRenderer.renderSuggestedChips(container, {
        language: 'en',
        slides: [{ title: 'Solar' }],
        suggested_chips: ['Review title', 'Add example', 'Ignored third'],
    }, {
        previousTimeout: 14,
        rememberTimeout(timeout) {
            rememberedTimeout = timeout;
        },
        translate(key, fallback) {
            translated.push([key, fallback]);
            return `translated:${key}`;
        },
        proceed() {
            generated.push('proceed');
        },
        submitPrompt(chip) {
            generated.push(chip.prompt);
        },
        animate(button, index) {
            animationOrder.push([button, index]);
        },
    });

    assert.equal(window.clearedTimeout, 14);
    assert.equal(timeouts[0].delay, 1000);
    assert.equal(rememberedTimeout, 1);
    assert.equal(container.children.length, 0);
    timeouts[0].callback();
    assert.equal(container.children.length, 3);
    assert.equal(container.children[2].innerHTML, 'translated:chip_fallback_generate_text');
    assert.equal(container.children[2].className, 'suggested-chip chip-primary');
    assert.deepEqual(animationOrder.map(([, index]) => index), [0, 1, 2]);
    assert.deepEqual(translated, [[
        'chip_fallback_generate_text',
        'Looks good! Create presentation',
    ]]);
    container.children[0].onClick();
    container.children[2].onClick();
    assert.deepEqual(generated, ['Review title', 'proceed']);
});
