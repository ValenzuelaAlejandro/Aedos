const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
    constructor() {
        this.children = [];
        this.parentElement = null;
        this.attributes = {};
        this.style = {};
        this.listeners = {};
        this.textContent = '';
        this.offsetWidth = 8;
        this.scrollWidth = 80;
        this.parentWidth = 20;
        this.classList = {
            values: new Set(),
            add: (name) => this.classList.values.add(name),
            contains: (name) => this.classList.values.has(name),
            toggle: (name, force) => {
                const enabled = force === undefined ? !this.classList.contains(name) : force;
                if (enabled) this.classList.add(name);
                else this.classList.values.delete(name);
                return enabled;
            },
        };
    }

    set className(value) {
        this._className = value;
        this.classList.values = new Set(value.split(/\s+/).filter(Boolean));
    }

    get className() {
        return this._className || '';
    }

    set innerHTML(value) {
        if (value === '') this.children = [];
    }

    get innerHTML() {
        return '';
    }

    get offsetParentWidth() {
        return this.parentElement ? this.parentElement.parentWidth : 0;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
    }

    addEventListener(type, callback) {
        this.listeners[type] = callback;
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    click() {
        if (this.listeners.click) this.listeners.click();
        if (this.onClick) this.onClick();
    }

    querySelectorAll() {
        return this.sourceDots || [];
    }
}

function loadMobileNavDots({ withSourceDots = true } = {}) {
    const sourceDots = new FakeElement();
    const mobileDots = new FakeElement();
    const label = new FakeElement();
    const intervalCallbacks = [];
    const listeners = {};
    const sourceButtons = Array.from({ length: 3 }, () => {
        const dot = new FakeElement();
        dot.clickCount = 0;
        dot.click = () => { dot.clickCount += 1; };
        return dot;
    });
    sourceDots.sourceDots = withSourceDots ? sourceButtons : [];
    let currentIndex = 1;
    let scrolledTo = null;
    const elements = {
        'slide-dots': sourceDots,
        'mobile-slide-dots': mobileDots,
        'mobile-slide-label': label,
        'preview-iframe': { contentDocument: null },
    };
    const document = {
        getElementById: (id) => elements[id] || null,
        createElement: () => new FakeElement(),
        addEventListener: (type, callback) => { listeners[type] = callback; },
    };
    const window = {
        getTotalSlides: () => 3,
        getCurrentSlide: () => currentIndex,
        scrollToSlide: (index) => { scrolledTo = index; },
        addEventListener: (type, callback) => { listeners[`window:${type}`] = callback; },
    };
    class MutationObserver {
        constructor(callback) {
            this.callback = callback;
        }

        observe() {}
    }
    const context = { window };
    vm.createContext(context);
    const modulePath = path.join(__dirname, '../src/frontend/mobile/js/nav-dots.js');
    vm.runInContext(fs.readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
    const api = window.AedosMobileNavDots.create({
        document,
        window,
        MutationObserver,
        setInterval: (callback) => intervalCallbacks.push(callback),
    });
    return {
        api,
        intervalCallbacks,
        label,
        mobileDots,
        sourceButtons,
        listeners,
        setCurrentIndex: (index) => { currentIndex = index; },
        getScrolledTo: () => scrolledTo,
    };
}

test('mobile navigation dots mirror count, active slide, label, and source-dot clicks', () => {
    const {
        api,
        intervalCallbacks,
        label,
        mobileDots,
        sourceButtons,
        listeners,
        setCurrentIndex,
    } = loadMobileNavDots();

    api.init();

    assert.equal(mobileDots.children.length, 3);
    assert.equal(mobileDots.children[1].classList.contains('active'), true);
    assert.equal(label.textContent, '2 / 3');
    mobileDots.children[1].click();
    assert.equal(sourceButtons[1].clickCount, 1);

    setCurrentIndex(2);
    listeners['window:resize']();
    assert.equal(mobileDots.children[2].classList.contains('active'), true);
    assert.equal(label.textContent, '3 / 3');
    assert.equal(intervalCallbacks.length, 1);
});

test('mobile navigation dots fall back to scrollToSlide when source dots are absent', () => {
    const { api, mobileDots, getScrolledTo } = loadMobileNavDots({ withSourceDots: false });

    api.init();
    mobileDots.children[2].click();

    assert.equal(getScrolledTo(), 2);
});
