const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
    constructor(name, parent = null) {
        this.name = name;
        this.parentElement = parent;
        this.style = {};
        this.nodeType = 1;
        this.children = [];
        if (parent) parent.children.push(this);
    }

    querySelectorAll() {
        return this.children.flatMap(child => [child, ...child.querySelectorAll()]);
    }

    matches() { return false; }

    closest() { return null; }

    contains(element) {
        return this === element || this.children.some(child => child.contains(element));
    }
}

function loadEditorTargeting() {
    const module = { exports: {} };
    const context = { module };
    vm.createContext(context);
    const sourcePath = path.join(__dirname, '../src/frontend/features/editor/targeting.js');
    const source = fs.readFileSync(sourcePath, 'utf8')
        .replace('export function createEditorTargeting', 'function createEditorTargeting') +
        '\nmodule.exports = { createEditorTargeting };';
    vm.runInContext(source, context, { filename: sourcePath });
    return module.exports.createEditorTargeting;
}

function createSemantics(slide, containers, editable) {
    return {
        getSlideRoot: () => slide,
        isIgnoredElement: () => false,
        isTextEditableElement: element => editable.has(element),
        isImageSlotElement: () => false,
        isVisualLeafElement: () => false,
        isSemanticContainer: element => containers.has(element),
        getNearestSemanticContainerAncestor(element) {
            let current = element.parentElement;
            while (current && current !== slide) {
                if (containers.has(current)) return current;
                current = current.parentElement;
            }
            return null;
        },
        isEditableElement: element => editable.has(element) || containers.has(element),
    };
}

test('editable traversal excludes nested items when resolving top-level targets', () => {
    const slide = new FakeElement('slide');
    const container = new FakeElement('container', slide);
    const label = new FakeElement('label', container);
    const editable = new Set([container, label]);
    const createEditorTargeting = loadEditorTargeting();
    const targeting = createEditorTargeting({
        document: { body: slide, querySelectorAll: () => [slide] },
        Element: FakeElement,
        Node: { ELEMENT_NODE: 1 },
        semantics: createSemantics(slide, new Set([container]), editable),
    });

    assert.deepEqual([...targeting.getTopLevelEditableElements(container)].map(element => element.name), ['label']);
    assert.deepEqual([...targeting.getTopLevelEditableElements(slide)].map(element => element.name), ['container']);
});

test('stable drag target promotes a nested editable to its semantic container', () => {
    const slide = new FakeElement('slide');
    const container = new FakeElement('container', slide);
    const label = new FakeElement('label', container);
    const createEditorTargeting = loadEditorTargeting();
    const targeting = createEditorTargeting({
        document: { body: slide, querySelectorAll: () => [] },
        Element: FakeElement,
        Node: { ELEMENT_NODE: 1 },
        semantics: createSemantics(slide, new Set([container]), new Set([label])),
    });

    assert.equal(targeting.getStableDragTarget(label), container);
});

test('slide editable targeting filters hidden nodes and excludes edited ancestors and descendants', () => {
    const slide = new FakeElement('slide');
    const visible = new FakeElement('visible', slide);
    const hidden = new FakeElement('hidden', slide);
    hidden.style.display = 'none';
    const parent = new FakeElement('parent', slide);
    const child = new FakeElement('child', parent);
    const editable = new Set([visible, hidden, parent, child]);
    const targeting = loadEditorTargeting()({
        document: { body: slide, querySelectorAll: () => [] },
        Element: FakeElement,
        Node: { ELEMENT_NODE: 1 },
        semantics: createSemantics(slide, new Set(), editable),
    });

    assert.deepEqual([...targeting.getEditableElementsInSlide(slide)].map(element => element.name), ['visible', 'parent', 'child']);
    assert.deepEqual([...targeting.getEditableElementsInSlide(slide, parent)].map(element => element.name), ['visible']);
    assert.equal(targeting.getEditableElementsInSlide(null).length, 0);
});
