const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createFixture() {
    const calls = [];
    const slide = {
        children: [],
        appendChild(node) {
            this.children.push(node);
            node.parentElement = this;
            calls.push(['append', node]);
        },
        querySelector(selector) {
            return this.children.find((node) => node.attributes['data-lucide'] &&
                selector.includes(node.attributes['data-lucide'])) || null;
        },
    };
    const iframeDoc = {
        body: slide,
        createElement(tagName) {
            return {
                tagName: tagName.toUpperCase(),
                attributes: {},
                style: {
                    setProperty(property, value) {
                        this[property] = value;
                    },
                },
                classList: { add: (name) => calls.push(['class', name]) },
                setAttribute(name, value) {
                    this.attributes[name] = value;
                },
                dispatchEvent: (event) => calls.push(['dispatch', event.type]),
            };
        },
    };
    const iframeWin = {
        editorSaveState: () => calls.push(['save']),
        editorSelect: (element) => calls.push(['select', element]),
        editorUpdateSelection: () => calls.push(['update']),
        lucide: { createIcons: () => calls.push(['icons']) },
    };
    const window = {};
    const context = { window };
    vm.createContext(context);
    const modulePath = path.join(__dirname, '../src/frontend/features/tools/shape-inserter.js');
    vm.runInContext(fs.readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
    const api = window.AedosEditorInsertions.create({ iframeDoc, iframeWin, getActiveSlide: () => slide });
    return { api, calls, slide };
}

test('shape insertion keeps defaults, custom CSS, save and selection lifecycle', () => {
    const { api, calls, slide } = createFixture();

    api.insertShape('rounded-box', 'rotate(5deg);background-color: red;');

    const shape = slide.children[0];
    assert.equal(shape.className, 'rounded-box shapes-added');
    assert.equal(shape.style.left, '50%');
    assert.equal(shape.style.width, '150px');
    assert.equal(shape.style['background-color'], 'red');
    assert.ok(calls.findIndex(([name]) => name === 'save') < calls.findIndex(([name]) => name === 'append'));
    assert.ok(calls.some(([name, element]) => name === 'select' && element === shape));
    assert.equal(calls.at(-1)[0], 'update');
});

test('icon insertion keeps Lucide replacement selection and update lifecycle', () => {
    const { api, calls, slide } = createFixture();

    api.insertIcon('sparkles');

    const icon = slide.children[0];
    assert.equal(icon.attributes['data-lucide'], 'sparkles');
    assert.equal(icon.style.width, '64px');
    assert.ok(calls.some(([name]) => name === 'icons'));
    assert.ok(calls.some(([name, element]) => name === 'select' && element === icon));
    assert.equal(calls.at(-1)[0], 'update');
});
