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
const editorBindingsPath = path.join(root, 'src/frontend/features/outline/editor-bindings.js');
const slideCommandsPath = path.join(root, 'src/frontend/features/outline/slide-commands.js');
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

test('outline editor bindings preserve live slide edits, point ordering, and count updates', () => {
    const timers = [];
    const selectors = new Map();
    const window = {
        clearTimeout() {},
        setTimeout(callback, delay) {
            timers.push({ callback, delay });
            return timers.length;
        },
        parseInt,
        Event: class Event {
            constructor(type) {
                this.type = type;
            }
        },
        document: {
            querySelectorAll(selector) {
                return selectors.get(selector) || [];
            },
        },
    };
    vm.runInNewContext(fs.readFileSync(editorBindingsPath, 'utf8'), { window }, { filename: editorBindingsPath });

    function makeField(dataset, value = '') {
        return {
            dataset,
            value,
            style: {},
            scrollHeight: 42,
            listeners: {},
            addEventListener(type, callback) {
                this.listeners[type] = callback;
            },
        };
    }

    const title = makeField({ index: '0' }, 'Edited title');
    const point = makeField({ sindex: '0', pindex: '0' }, 'New point');
    selectors.set('.outline-slide-title', [title]);
    selectors.set('.outline-point-input', [point]);
    const slides = [{ title: 'Original', key_points: ['First', 'Second'] }];
    let renderCount = 0;
    let countUpdates = 0;
    window.AedosOutlineEditorBindings.bindOutlineEditorEvents({
        getSlides: () => slides,
        renderSlides: () => { renderCount += 1; },
        updateSlideCount: () => { countUpdates += 1; },
    });

    assert.equal(title.style.height, '42px');
    title.listeners.input({ target: title });
    const titleTimer = timers.pop();
    assert.equal(titleTimer.delay, 80);
    titleTimer.callback();
    assert.equal(slides[0].title, 'Edited title');
    point.listeners.input({ target: point });
    const pointTimer = timers.pop();
    assert.equal(pointTimer.delay, 80);
    pointTimer.callback();
    assert.equal(slides[0].key_points[0], 'New point');

    const event = {
        key: 'Enter',
        shiftKey: false,
        target: point,
        preventDefault() {
            this.prevented = true;
        },
    };
    point.listeners.keydown(event);
    assert.equal(event.prevented, true);
    assert.deepEqual(slides[0].key_points, ['New point', '', 'Second']);
    assert.equal(renderCount, 1);
    assert.equal(countUpdates, 1);
});

function createSlideCommandHarness() {
    const frames = [];
    const timers = [];
    const main = { scrollTop: 4, scrollHeight: 80 };
    const cards = [];
    const pointList = { appendChild(item) { this.item = item; } };
    const document = {
        querySelector(selector) {
            return selector === '.outline-main' ? main : null;
        },
        querySelectorAll(selector) {
            return selector === '.outline-slide-card' ? cards : [];
        },
        getElementById(id) {
            return id === 'outline-points-0' ? pointList : null;
        },
        createElement(tagName) {
            assert.equal(tagName, 'div');
            const listeners = {};
            const classes = new Set();
            const textarea = {
                dataset: { sindex: '0', pindex: '1' },
                style: {},
                value: '',
                scrollHeight: 32,
                addEventListener: (name, callback) => { listeners[`textarea:${name}`] = callback; },
                focus() { this.focused = true; },
            };
            const deleteButton = {
                dataset: { sindex: '0', pindex: '1' },
                addEventListener: (name, callback) => { listeners[`delete:${name}`] = callback; },
            };
            return {
                classList: {
                    add: (name) => classes.add(name),
                    remove: (...names) => names.forEach((name) => classes.delete(name)),
                },
                querySelector(selector) {
                    return selector === '.outline-point-input' ? textarea : deleteButton;
                },
                get listeners() { return listeners; },
                textarea,
                deleteButton,
            };
        },
    };
    const window = {
        document,
        confirm: () => true,
        parseInt,
        requestAnimationFrame(callback) {
            frames.push(callback);
        },
        setTimeout(callback, delay) {
            timers.push({ callback, delay });
        },
    };
    vm.runInNewContext(fs.readFileSync(slideCommandsPath, 'utf8'), { window }, { filename: slideCommandsPath });

    const slides = [{ title: 'First', key_points: ['Existing'] }];
    let renders = 0;
    const dependencies = {
        getSlides: () => slides,
        getMaxSlides: () => 3,
        renderSlides: () => { renders += 1; },
    };
    return {
        frames,
        timers,
        main,
        cards,
        pointList,
        slides,
        getRenders: () => renders,
        commands: window.AedosOutlineSlideCommands,
        dependencies,
    };
}

test('outline slide commands preserve add, reorder, and animation callbacks', () => {
    const { frames, timers, main, cards, slides, getRenders, commands, dependencies } = createSlideCommandHarness();
    commands.addBlankSlide(dependencies);
    assert.equal(slides.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(slides[1])), {
        role: 'concept', title: '', subtitle: '', key_points: [],
    });
    const cardClasses = new Set();
    cards.push({ classList: {
        add: (name) => cardClasses.add(name),
        remove: (...names) => names.forEach((name) => cardClasses.delete(name)),
    } });
    frames.shift()();
    assert.equal(main.scrollTop, main.scrollHeight);
    assert.equal(cardClasses.has('is-new'), true);
    frames.shift()();
    assert.equal(cardClasses.has('is-new-visible'), true);
    assert.equal(timers.shift().delay, 500);

    commands.moveSlideDown(0, dependencies);
    assert.equal(slides[0].title, '');
    assert.equal(getRenders(), 2);
    frames.shift()();
    assert.equal(main.scrollTop, 80);
    commands.moveSlideUp(1, dependencies);
    assert.equal(slides[0].title, 'First');
    frames.shift()();
});

test('outline point command preserves inline editing and delete callbacks', () => {
    const { frames, pointList, slides, getRenders, commands, dependencies } = createSlideCommandHarness();
    commands.addBlankPoint(0, dependencies);
    assert.deepEqual(slides[0].key_points, ['Existing', '']);
    assert.equal(pointList.item.textarea.focused, true);
    pointList.item.textarea.value = 'Added point';
    pointList.item.listeners['textarea:input']({ target: pointList.item.textarea });
    assert.equal(slides[0].key_points[1], 'Added point');
    pointList.item.listeners['delete:click']();
    assert.deepEqual(slides[0].key_points, ['Existing']);
    assert.equal(getRenders(), 1);
    assert.equal(frames.length, 1);
});

test('outline slide deletion preserves confirmation and rerender behavior', () => {
    const { slides, getRenders, commands, dependencies } = createSlideCommandHarness();
    commands.deleteSlide(0, dependencies);
    assert.deepEqual(slides, []);
    assert.equal(getRenders(), 1);
});
