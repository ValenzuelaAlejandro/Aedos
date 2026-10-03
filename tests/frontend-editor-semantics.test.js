const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeElementClass() {
    return class Element {
        constructor(
            tagName,
            { display = 'block', classes = [], childNodes = [], children = [], slide = null } = {},
        ) {
            this.tagName = tagName.toUpperCase();
            this.display = display;
            this.classes = new Set(classes);
            this.childNodes = childNodes;
            this.children = children;
            this.slide = slide;
            this.dataset = {};
        }

        matches(selector) {
            const selectors = selector.split(',').map((value) => value.trim());
            return (
                selectors.includes(this.tagName.toLowerCase()) ||
                selectors.some((value) => this.classes.has(value.slice(1)))
            );
        }

        closest(selector) {
            if (this.matches(selector)) return this;
            if (selector.includes('.s') && this.slide) return this.slide;
            return null;
        }

        querySelector() {
            return null;
        }
    };
}

function loadEditorSemantics() {
    const Element = makeElementClass();
    const body = new Element('body');
    const document = { body, documentElement: new Element('html') };
    const window = {
        getComputedStyle: (element) => ({
            display: element.display,
            backgroundImage: 'none',
            backgroundColor: 'transparent',
        }),
    };
    const context = { Element, Node: { TEXT_NODE: 3 }, document, window };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/semantics.js');
    vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
    return { api: window.AedosEditorSemantics.create(), body, Element, window };
}

test('editor semantics preserve slide roots, text targets, inline exclusion and image slots', () => {
    const { api, body, Element } = loadEditorSemantics();
    const slide = new Element('section', { classes: ['s'] });
    const heading = new Element('h1', { slide });
    const inlineText = new Element('span', {
        display: 'inline',
        childNodes: [{ nodeType: 3, textContent: 'inline text' }],
        slide,
    });
    const freeText = new Element('div', {
        childNodes: [{ nodeType: 3, textContent: 'free text' }],
        slide,
    });
    const imageSlot = new Element('div', { classes: ['img-slot'], slide });

    assert.equal(api.getSlideRoot(heading), slide);
    assert.equal(api.getSlideRoot(body), body);
    assert.equal(api.isTextEditableElement(heading), true);
    assert.equal(api.isTextEditableElement(inlineText), false);
    assert.equal(api.isTextEditableElement(freeText), true);
    assert.equal(api.isImageSlotElement(imageSlot), true);
});

test('editor semantics continue to ignore editor chrome and expose the same selector contract', () => {
    const { api, Element, window } = loadEditorSemantics();
    const toolbar = new Element('div', { classes: ['editor-toolbar'] });

    assert.equal(api.isIgnoredElement(toolbar), true);
    assert.ok(api.editableSelectors.includes('[data-container="true"]'));
    assert.equal(window.editableSelectors, undefined);
});
