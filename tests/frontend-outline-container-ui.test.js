const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const modulePath = path.join(__dirname, '../src/frontend/features/outline/container-ui.js');

test('outline container UI preserves form submission, active bubble, and action binding', () => {
    const outlineState = { skeleton: { slides: [{ key_points: ['Keep', '', null, 'Also keep'] }] } };
    let addSlideCalls = 0;
    let generatedSkeleton = null;
    let prevented = false;
    const generateButton = {
        dataset: {},
        disabled: false,
        classList: { add(value) { this.added = value; } },
        addEventListener(name, callback) { this[name] = callback; },
    };
    const addSlideButton = {
        dataset: {},
        addEventListener(name, callback) { this[name] = callback; },
    };
    const container = {
        querySelector(selector) {
            if (selector === '[data-outline-generate]' || selector === '#btn-outline-generate') return generateButton;
            if (selector === '[data-outline-add-slide]' || selector === '#btn-outline-add-slide') return addSlideButton;
            return null;
        },
    };
    const elements = {
        'outline-container': container,
        'outline-title-input': { value: 'Topic' },
        'outline-tone-select': { value: 'warm' },
        'outline-audience-select': { value: 'students' },
        'outline-density-select': { value: 'compact' },
        'outline-subtitle-input': { value: '  context  ' },
    };
    const document = {
        body: { contains: element => element === container },
        getElementById(id) { return elements[id] || null; },
    };
    const window = {};
    vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), { window }, { filename: modulePath });
    const ui = window.AedosOutlineContainerUi.createOutlineContainerUi({
        document,
        getState: () => outlineState,
        addBlankSlide: () => { addSlideCalls += 1; },
        translate: (key, fallback) => `${key}:${fallback}`,
        alert: message => assert.match(message, /^outline_empty_slides:/),
        startFinalGeneration: skeleton => { generatedSkeleton = skeleton; },
    });

    assert.equal(ui.getActiveOutlineContainer(), container);
    assert.equal(ui.getOutlineDom().generateButton, generateButton);
    ui.bindOutlineBubbleActions(container);
    ui.bindOutlineBubbleActions(container);
    addSlideButton.click({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(addSlideCalls, 1);

    generateButton.click();
    assert.equal(generatedSkeleton, outlineState.skeleton);
    assert.deepEqual(JSON.parse(JSON.stringify(outlineState.skeleton)), {
        slides: [{ key_points: ['Keep', 'Also keep'] }],
        topic: 'Topic',
        tone: 'warm',
        audience: 'students',
        density: 'compact',
        subtitle_context: 'context',
    });
    assert.equal(generateButton.disabled, true);
    assert.equal(generateButton.classList.added, 'is-generating');
});
