/// <reference path="./browser-globals.d.ts" />
/* global MouseEvent, document, getComputedStyle, window */
const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./runtime');
const { requestTopic, startPresentation, getEditorFrame } = require('./check-flow');

/** @typedef {import('puppeteer').Page} BrowserPage */
/** @typedef {Record<string, Array<[string, string]>>} SourceMutations */

const topic = 'Energía solar para ciudades resilientes';
const captureDir = path.join(root, 'tmp/editor-safety-mutations');

async function openOutline(runtime, mutations) {
    const page = await runtime.newPage(mutations);
    await requestTopic(page, topic);
    await page.waitForSelector('#outline-container:not(.hidden)', { timeout: 12000 });
    await page.waitForFunction(() => !window.outlineEditorState?.isLoading, { timeout: 12000 });
    return page;
}

async function capture(page, name) {
    fs.mkdirSync(captureDir, { recursive: true });
    fs.writeFileSync(path.join(captureDir, `${name}.png`), await page.screenshot({ type: 'png' }));
}

async function probeOutline(runtime, mutations, probe, name) {
    const page = await openOutline(runtime, mutations);
    try {
        let result;
        if (probe === 'add') {
            await page.$eval('#btn-outline-add-slide', (button) => button.click());
            result = { count: await page.$$eval('#outline-slides-container .seamless-slide-item', (items) => items.length) };
        } else if (probe === 'title') {
            await page.locator('#outline-slide-title-0').fill('Mutation title sentinel');
            await new Promise((resolve) => setTimeout(resolve, 120));
            result = { title: await page.evaluate(() => window.outlineEditorState.skeleton.slides[0].title) };
        } else if (probe === 'point') {
            await page.locator('#outline-slide-0-point-0').fill('Mutation point sentinel');
            await new Promise((resolve) => setTimeout(resolve, 120));
            result = { point: await page.evaluate(() => window.outlineEditorState.skeleton.slides[0].key_points[0]) };
        } else if (probe === 'delete') {
            await page.evaluate(() => { window.confirm = () => true; window.deleteSlide(0); });
            result = await page.evaluate(() => ({ count: window.outlineEditorState.skeleton.slides.length, first: window.outlineEditorState.skeleton.slides[0]?.title }));
        } else if (probe === 'up' || probe === 'down') {
            await page.evaluate((direction) => direction === 'up' ? window.moveSlideUp(1) : window.moveSlideDown(0), probe);
            result = { titles: await page.evaluate(() => window.outlineEditorState.skeleton.slides.map((slide) => slide.title)) };
        } else {
            result = { count: await page.$$eval('#outline-slides-container .seamless-slide-item', (items) => items.length) };
        }
        await capture(page, name);
        return result;
    } finally {
        await page.close();
    }
}

async function probeValidation(runtime, mutations, name) {
    const page = await runtime.newPage(mutations);
    try {
        await page.$eval('#w-tema', (input) => input.dispatchEvent(new Event('input', { bubbles: true })));
        const result = { disabled: await page.$eval('#btn-generate', (button) => button.disabled) };
        await capture(page, name);
        return result;
    } finally { await page.close(); }
}

async function probeError(runtime, mutations, name) {
    runtime.setPlans([{ status: 429, type: 'application/json', body: JSON.stringify({ error: 'MOCK_HTTP_429' }) }]);
    const page = await runtime.newPage(mutations);
    try {
        await requestTopic(page, 'Error path 429');
        await page.waitForFunction(() => !document.getElementById('error-container')?.classList.contains('hidden'), { timeout: 2500 }).catch(() => {});
        const result = {
            message: await page.$eval('#error-message', (el) => el.textContent),
            visible: await page.$eval('#error-container', (el) => !el.classList.contains('hidden')),
        };
        await capture(page, name);
        return result;
    } finally { await page.close(); }
}

async function probePreview(runtime, mutations, name) {
    const page = await openOutline(runtime, mutations);
    try {
        await page.waitForSelector('#outline-suggested-chips .chip-primary', { timeout: 10000 });
        await page.click('#outline-suggested-chips .chip-primary');
        await page.waitForFunction(() => !document.getElementById('preview-container')?.classList.contains('hidden'), { timeout: 10000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 350));
        const result = await page.$eval('#preview-iframe', (frame) => ({
            count: /** @type {HTMLIFrameElement} */ (frame).contentDocument?.querySelectorAll('section.s').length || 0,
        }));
        await capture(page, name);
        return result;
    } finally { await page.close(); }
}

async function probeEditor(runtime, mutations, probe, name) {
    const page = await openOutline(runtime, mutations);
    try {
        let frame = await startPresentation(page);
        await page.waitForFunction(() => {
            const preview = document.getElementById('preview-container');
            const iframe = /** @type {HTMLIFrameElement | null} */ (document.getElementById('preview-iframe'));
            return preview?.classList.contains('is-editor-ready') &&
                iframe?.contentDocument?.querySelector('section.s h1');
        }, { timeout: 12000 });
        frame = await getEditorFrame(page);
        if (probe === 'selection') {
            const result = await frame.evaluate(() => {
                const title = document.querySelector('section.s.active h1') || document.querySelector('section.s h1');
                window.editorSelect(title);
                return { selected: window.editorGetSelection()?.tagName || null };
            });
            await capture(page, name);
            return result;
        }
        if (probe === 'undo') {
            await frame.evaluate(() => window.editorSelect(document.querySelector('section.s.active h1')));
            const before = await frame.$eval('section.s.active h1', (el) => el.getBoundingClientRect().width);
            await frame.evaluate(() => {
                const handle = document.querySelector('.editor-resize-se');
                const rect = handle.getBoundingClientRect();
                const x = rect.x + rect.width / 2;
                const y = rect.y + rect.height / 2;
                handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
                document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 32, clientY: y + 22 }));
                document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + 32, clientY: y + 22 }));
            });
            await frame.evaluate(() => window.editorUndo());
            const after = await frame.$eval('section.s.active h1', (el) => el.getBoundingClientRect().width);
            const result = { restored: Math.abs(after - before) <= 2 };
            await capture(page, name);
            return result;
        }

        await page.evaluate(() => window.initTools(/** @type {HTMLIFrameElement} */ (document.getElementById('preview-iframe'))));
        await frame.evaluate(() => {
            const target = document.querySelector('section.s.active h1');
            window.editorSelect(target);
            window.dispatchEvent(new CustomEvent('selection-changed', { detail: { element: target } }));
        });
        await page.waitForSelector('#tool-layer-up', { timeout: 5000 });
        const before = await frame.$eval('section.s.active h1', (el) => Number(getComputedStyle(el).zIndex) || 0);
        await page.$eval('#tool-layer-up', (button) => button.click());
        const after = await frame.$eval('section.s.active h1', (el) => Number(getComputedStyle(el).zIndex) || 0);
        const result = { raised: after > before };
        await capture(page, name);
        return result;
    } finally { await page.close(); }
}

async function runProbe(runtime, mutations, probe, name) {
    if (['add', 'title', 'point', 'delete', 'up', 'down', 'finalize'].includes(probe)) return probeOutline(runtime, mutations, probe, name);
    if (probe === 'validation') return probeValidation(runtime, mutations, name);
    if (probe === 'error') return probeError(runtime, mutations, name);
    if (probe === 'preview') return probePreview(runtime, mutations, name);
    return probeEditor(runtime, mutations, probe, name);
}

module.exports = { runProbe };
