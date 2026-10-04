/// <reference path="./browser-globals.d.ts" />
/* global document, getComputedStyle, MouseEvent, requestAnimationFrame, window */
const assert = require('node:assert/strict');
const { startRuntime } = require('./runtime');
const { assertDomContract, requestTopic, outlineCount, assertMainFlowTrace, runErrorScenario, runValidation } = require('./browser-contracts');
const { checkpoint: captureCheckpoint } = require('./visual-checkpoint');

/** @typedef {import('puppeteer').Page} BrowserPage */
/** @typedef {(page: BrowserPage, name: string, assertion: () => Promise<void>) => Promise<void>} Checkpoint */

async function selectLanguage(page) {
    await page.click('#btn-lang-dropdown');
    await page.click('#lang-dropdown-menu [data-lang="ja"]');
    assert.equal(await page.$eval('#current-lang-label', (el) => el.textContent.trim()), '日本語');
}

async function startPresentation(page) {
    await page.waitForSelector('#outline-suggested-chips .suggested-chip.chip-primary', { timeout: 10000 });
    await page.evaluate(() => {
        const motionStyle = document.createElement('style');
        motionStyle.id = 'editor-safety-parent-motion-override';
        motionStyle.textContent = `
            #preview-container#preview-container *,
            #preview-container#preview-container *::before,
            #preview-container#preview-container *::after {
                animation: none !important;
                transition: none !important;
            }
        `;
        document.head.appendChild(motionStyle);
        const header = /** @type {HTMLElement | null} */ (document.querySelector('.preview-unified-header'));
        header?.style.setProperty('transition', 'none', 'important');
        header?.style.setProperty('animation', 'none', 'important');
    });
    await page.click('#outline-suggested-chips .suggested-chip.chip-primary');
    await page.waitForFunction(() => {
        const preview = document.getElementById('preview-container');
        return preview && !preview.classList.contains('hidden') &&
            /** @type {HTMLIFrameElement | null} */ (document.getElementById('preview-iframe'))?.contentDocument?.querySelector('section.s h1');
    }, { timeout: 15000 });
    await page.waitForFunction(() => {
        const preview = document.getElementById('preview-container');
        const header = document.querySelector('.preview-unified-header');
        return preview?.classList.contains('is-editor-ready') &&
            !preview.classList.contains('is-settling') &&
            getComputedStyle(header).opacity === '1' &&
            /** @type {HTMLIFrameElement | null} */ (document.getElementById('preview-iframe'))?.contentDocument?.querySelector('section.s h1');
    }, { timeout: 15000 });
    return getEditorFrame(page);
}

async function getEditorFrame(page) {
    const iframe = await page.$('#preview-iframe');
    if (!iframe) throw new Error('Preview iframe element was replaced or removed');
    const frame = await iframe.contentFrame();
    await frame.waitForFunction(() => typeof window.editorSelect === 'function', { timeout: 10000 });
    return frame;
}

async function runLanguageAndTheme(page, checkpoint) {
    await checkpoint(page, 'flow-01-landing', async () => assertDomContract(page));
    await selectLanguage(page);
    await checkpoint(page, 'flow-02-language-ja', async () => {
        assert.equal(await page.$eval('#current-lang-label', (el) => el.textContent.trim()), '日本語');
    });
    const initialTheme = await page.$eval('html', (el) => el.dataset.theme);
    await page.click('#theme-toggle-btn');
    await checkpoint(page, 'flow-theme-chat-toggle', async () => {
        assert.notEqual(await page.$eval('html', (el) => el.dataset.theme), initialTheme);
    });
    await page.click('#theme-toggle-btn');
    await checkpoint(page, 'flow-theme-chat-reset', async () => {
        assert.equal(await page.$eval('html', (el) => el.dataset.theme), initialTheme);
    });
}

async function runOutlineFlow(page, checkpoint) {
    await requestTopic(page, 'Energía solar para ciudades resilientes');
    await page.waitForSelector('#outline-container:not(.hidden) .seamless-slide-item', { timeout: 15000 });
    await checkpoint(page, 'flow-03-outline-streamed', async () => {
        assert.equal(await outlineCount(page), 3);
        assert.equal(await page.evaluate(() => window.outlineEditorState.skeleton.topic), 'Energía solar para ciudades resilientes');
    });
    // The app intentionally hides the legacy outline footer with CSS; dispatch
    // its bound action and document this as non-pointer coverage below.
    await page.$eval('#btn-outline-add-slide', (button) => button.click());
    await page.waitForFunction(() => document.querySelectorAll('#outline-suggested-chips .suggested-chip').length >= 2, { timeout: 10000 });
    await checkpoint(page, 'flow-04-outline-added', async () => assert.equal(await outlineCount(page), 4));
    await page.locator('#outline-slide-title-0').fill('La energía solar en cada ciudad');
    await page.locator('#outline-slide-0-point-0').fill('Radiación medida durante todo el año');
    await page.waitForFunction(() => {
        const slide = window.outlineEditorState?.skeleton?.slides?.[0];
        return slide?.title === 'La energía solar en cada ciudad' &&
            slide.key_points?.[0] === 'Radiación medida durante todo el año' &&
            document.querySelectorAll('#outline-suggested-chips .suggested-chip').length >= 2;
    }, { timeout: 10000 });
    await checkpoint(page, 'flow-05-outline-edited', async () => {
        const state = await page.evaluate(() => window.outlineEditorState.skeleton.slides[0]);
        assert.equal(state.title, 'La energía solar en cada ciudad');
        assert.equal(state.key_points[0], 'Radiación medida durante todo el año');
    });
    await page.evaluate(() => { window.confirm = () => true; window.deleteSlide(3); });
    await checkpoint(page, 'flow-06-outline-deleted', async () => assert.equal(await outlineCount(page), 3));
    await page.evaluate(() => window.moveSlideUp(1));
    await checkpoint(page, 'flow-07-outline-reordered', async () => {
        assert.equal(await page.$eval('#outline-slide-title-0', (el) => el.value), 'De panel a red eléctrica');
        assert.equal(await page.evaluate(() => window.outlineEditorState.skeleton.slides[1].title), 'La energía solar en cada ciudad');
    });
    await page.waitForSelector('#outline-suggested-chips .suggested-chip', { timeout: 10000 });
    await checkpoint(page, 'flow-08-outline-chips', async () => {
        assert.ok(await page.$$eval('#outline-suggested-chips .suggested-chip', (buttons) => buttons.length >= 2));
        assert.ok(await page.$('#outline-suggested-chips .chip-primary'));
    });
}

async function runEditorSelectionFlow(page, checkpoint, frame) {
    frame.current = await getEditorFrame(page);
    await frame.current.evaluate(() => {
        const title = document.querySelector('section.s.active h1') || document.querySelector('section.s h1');
        window.editorSelect(title);
    });
    await checkpoint(page, 'flow-10-editor-selected', async () => {
        frame.current = await getEditorFrame(page);
        assert.equal(await frame.current.evaluate(() => window.editorGetSelection()?.tagName), 'H1');
        await page.waitForFunction(() => {
            const panel = document.getElementById('editor-tools-panel');
            return panel?.classList.contains('active') && Number(getComputedStyle(panel).opacity) >= 0.99 &&
                document.getElementById('tool-layer-up');
        }, { timeout: 5000 });
    });
    frame.current = await getEditorFrame(page);
    const beforeMove = await frame.current.$eval('section.s.active h1', (el) => el.getBoundingClientRect().left);
    await frame.current.evaluate(() => {
        const box = document.querySelector('.editor-selection-box');
        if (!box) throw new Error('Editor selection box was not rendered');
        const rect = box.getBoundingClientRect();
        const startX = rect.x + rect.width / 2;
        const startY = rect.y + rect.height / 2;
        box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: startX + 40, clientY: startY + 24 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: startX + 40, clientY: startY + 24 }));
    });
    await checkpoint(page, 'flow-11-editor-moved', async () => {
        frame.current = await getEditorFrame(page);
        assert.notEqual(await frame.current.$eval('section.s.active h1', (el) => el.getBoundingClientRect().left), beforeMove);
    });
    frame.current = await getEditorFrame(page);
    const beforeResize = await frame.current.$eval('section.s.active h1', (el) => el.getBoundingClientRect().width);
    await frame.current.evaluate(() => {
        const handle = document.querySelector('.editor-resize-se');
        if (!handle) throw new Error('Editor southeast resize handle was not rendered');
        const rect = handle.getBoundingClientRect();
        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.x + rect.width / 2 + 36, clientY: rect.y + rect.height / 2 + 24 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.x + rect.width / 2 + 36, clientY: rect.y + rect.height / 2 + 24 }));
    });
    await checkpoint(page, 'flow-12-editor-resized', async () => {
        frame.current = await getEditorFrame(page);
        assert.notEqual(await frame.current.$eval('section.s.active h1', (el) => el.getBoundingClientRect().width), beforeResize);
    });
    return beforeResize;
}

async function runEditorHistoryAndLayers(page, checkpoint, frame, beforeResize) {
    frame.current = await getEditorFrame(page);
    const resizedWidth = await frame.current.$eval('section.s.active h1', (el) => el.getBoundingClientRect().width);
    await frame.current.evaluate(() => window.editorUndo());
    await checkpoint(page, 'flow-13-editor-undo', async () => {
        frame.current = await getEditorFrame(page);
        const width = await frame.current.$eval('section.s.active h1', (el) => el.getBoundingClientRect().width);
        assert.ok(Math.abs(width - beforeResize) <= 2, `Undo did not restore width: ${width} vs ${beforeResize}`);
    });
    frame.current = await getEditorFrame(page);
    const redoThumbnailLoad = await watchThumbnailLoad(page);
    await frame.current.evaluate(() => window.editorRedo());
    await waitForThumbnailLoad(page, redoThumbnailLoad);
    await checkpoint(page, 'flow-14-editor-redo', async () => {
        frame.current = await getEditorFrame(page);
        const width = await frame.current.$eval('section.s.active h1', (el) => el.getBoundingClientRect().width);
        assert.ok(Math.abs(width - resizedWidth) <= 2, `Redo did not restore width: ${width} vs ${resizedWidth}`);
    });
    frame.current = await getEditorFrame(page);
    await frame.current.evaluate(() => {
        const title = document.querySelector('section.s.active h1') || document.querySelector('section.s h1');
        title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await page.keyboard.type(' — edición manual');
    await frame.current.evaluate(() => /** @type {HTMLElement} */ (document.activeElement).blur());
    await checkpoint(page, 'flow-15-editor-text', async () => {
        frame.current = await getEditorFrame(page);
        assert.match(await frame.current.$eval('section.s.active h1', (el) => el.textContent), /edición manual/);
    });
    frame.current = await getEditorFrame(page);
    const previousToolsMarkup = await page.$eval('#dynamic-tools-container', (el) => el.innerHTML);
    await frame.current.evaluate(() => {
        window.editorSelect(document.querySelector('section.s.active .layer-back'));
        window.toFront();
    });
    await page.waitForFunction((previousMarkup) => {
        const panel = document.getElementById('editor-tools-panel');
        const tools = document.getElementById('dynamic-tools-container');
        return panel?.classList.contains('active') &&
            Number(getComputedStyle(panel).opacity) >= 0.99 &&
            tools?.innerHTML !== previousMarkup &&
            !tools?.querySelector('#tool-font-size');
    }, { timeout: 5000 }, previousToolsMarkup);
    await checkpoint(page, 'flow-16-editor-layer', async () => {
        frame.current = await getEditorFrame(page);
        assert.ok(await frame.current.$eval('.layer-back', (el) => Number(getComputedStyle(el).zIndex) > 2));
    });
}

async function watchThumbnailLoad(page, requestedIndex = null) {
    const index = requestedIndex ?? await page.$eval('#preview-iframe', (iframe) =>
        [...iframe.contentDocument.querySelectorAll('section.s')].findIndex((slide) => slide.classList.contains('active')));
    const selector = `#minimap-list > .minimap-item[data-index="${index}"] iframe`;
    const previousLoads = await page.$eval(selector, (iframe) => {
        iframe.dataset.editorSafetyLoadCount ||= '0';
        if (iframe.dataset.editorSafetyLoadListener !== 'installed') {
            iframe.dataset.editorSafetyLoadListener = 'installed';
            iframe.addEventListener('load', () => {
                iframe.dataset.editorSafetyLoadCount = String(Number(iframe.dataset.editorSafetyLoadCount || 0) + 1);
            });
        }
        return Number(iframe.dataset.editorSafetyLoadCount);
    });
    return { selector, previousLoads };
}

async function waitForThumbnailLoad(page, watch) {
    await page.waitForFunction(({ selector, previousLoads }) => {
        const iframe = document.querySelector(selector);
        return Number(iframe?.dataset.editorSafetyLoadCount || 0) > previousLoads;
    }, { timeout: 15000 }, watch);
    const iframe = await page.$(watch.selector);
    if (!iframe) throw new Error(`Minimap thumbnail disappeared: ${watch.selector}`);
    const frame = await iframe.contentFrame();
    if (!frame) throw new Error(`Minimap thumbnail has no content frame: ${watch.selector}`);
    await frame.waitForFunction(() => document.readyState === 'complete' && document.fonts?.status !== 'loading', { timeout: 10000 });
    await frame.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForFunction((selector) => new Promise((resolve) => {
        let previous = '';
        let stableFrames = 0;
        const sample = () => {
            const thumbnail = document.querySelector(selector);
            const tile = thumbnail?.closest('.minimap-item');
            if (!tile) throw new Error(`Minimap tile disappeared: ${selector}`);
            const rect = tile.getBoundingClientRect();
            const style = getComputedStyle(tile);
            const signature = JSON.stringify([
                rect.x, rect.y, rect.width, rect.height,
                style.transform, style.opacity, style.borderColor, style.borderWidth, style.boxShadow,
            ]);
            stableFrames = signature === previous ? stableFrames + 1 : 0;
            previous = signature;
            if (stableFrames >= 3) resolve(true);
            else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    }), { timeout: 5000 }, watch.selector);
}

async function runMinimapFlow(page, checkpoint) {
    const zoomBefore = await page.$eval('#canvas-zoom-display', (el) => el.textContent.trim());
    await page.click('#btn-zoom-out');
    await checkpoint(page, 'flow-17-editor-zoom', async () => {
        assert.notEqual(await page.$eval('#canvas-zoom-display', (el) => el.textContent.trim()), zoomBefore);
    });
    await page.click('#btn-zoom-in');
    await checkpoint(page, 'flow-18-editor-zoom-reset', async () => {
        assert.equal(await page.$eval('#canvas-zoom-display', (el) => el.textContent.trim()), zoomBefore);
    }, { hideMinimap: true });
    await page.waitForFunction(() => document.querySelectorAll('#minimap-list > *').length >= 2, { timeout: 12000 });
    const firstThumbnailLoad = await watchThumbnailLoad(page, 0);
    await page.click('#minimap-list > *:first-child');
    await waitForThumbnailLoad(page, firstThumbnailLoad);
    await waitForHoveredMinimapItem(page, '#minimap-list > *:first-child');
    await checkpoint(page, 'flow-19-editor-minimap', async () => {
        assert.ok(await page.$$eval('#minimap-list > *', (items) => items.length >= 2));
        assert.equal(await page.$eval('#minimap-list > *:first-child', (item) => item.classList.contains('active')), true);
        const editor = await getEditorFrame(page);
        assert.equal(await editor.evaluate(() =>
            [...document.querySelectorAll('section.s')].findIndex((section) => section.classList.contains('active'))), 0);
    });
    const secondThumbnailLoad = await watchThumbnailLoad(page, 1);
    await page.click('#minimap-list > *:nth-child(2)');
    await waitForThumbnailLoad(page, secondThumbnailLoad);
    await waitForHoveredMinimapItem(page, '#minimap-list > *:nth-child(2)');
    await checkpoint(page, 'flow-20-minimap-navigation', async () => {
        assert.ok(await page.$eval('#minimap-list > *:nth-child(2)', (el) => el.classList.contains('active')));
        const editor = await getEditorFrame(page);
        assert.equal(await editor.evaluate(() =>
            [...document.querySelectorAll('section.s')].findIndex((section) => section.classList.contains('active'))), 1);
    });
}

async function waitForHoveredMinimapItem(page, selector) {
    await page.hover(selector);
    await page.waitForFunction((itemSelector) => document.querySelector(itemSelector)?.matches(':hover'), { timeout: 3000 }, selector);
}

async function runExportFlow(page, runtime, checkpoint) {
    await page.click('#export-menu-trigger');
    await checkpoint(page, 'flow-22-export-menu', async () => {
        assert.equal(await page.$eval('#export-dropdown-menu', (el) => el.classList.contains('hidden')), false);
    });
    await page.click('#finalize-btn');
    await checkpoint(page, 'flow-23-export-pdf', async () => {
        assert.ok(runtime.trace.some((entry) => entry.path === '/finalize'));
    });
    await page.waitForFunction(() => !/** @type {HTMLButtonElement | null} */ (document.querySelector('#finalize-btn'))?.disabled, { timeout: 5000 });
    await page.click('#export-menu-trigger');
    const pptxResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/finalize-pptx', { timeout: 10000 });
    await page.click('#export-pptx-btn');
    await pptxResponse;
    await checkpoint(page, 'flow-24-export-pptx', async () => {
        assert.ok(runtime.trace.some((entry) => entry.path === '/finalize-pptx'));
    });
}

async function runMainFlow(runtime) {
    const page = await runtime.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    const frame = { current: null };
    try {
        await runLanguageAndTheme(page, captureCheckpoint);
        await runOutlineFlow(page, captureCheckpoint);
        frame.current = await startPresentation(page);
        await captureCheckpoint(page, 'flow-09-preview-iframe', async () => {
            frame.current = await getEditorFrame(page);
            assert.equal(await frame.current.$$eval('section.s', (slides) => slides.length), 2);
            assert.equal(await page.$eval('#preview-topic-label', (el) => el.value || el.textContent), 'La energía que llega del sol');
        });
        const beforeResize = await runEditorSelectionFlow(page, captureCheckpoint, frame);
        await runEditorHistoryAndLayers(page, captureCheckpoint, frame, beforeResize);
        await runMinimapFlow(page, captureCheckpoint);
        await runExportFlow(page, runtime, captureCheckpoint);
        assertMainFlowTrace(runtime.trace);
        assert.deepEqual(pageErrors.map((error) => error.message), [], 'browser flow must not produce uncaught page errors');
    } finally {
        await page.close();
    }
}

async function run() {
    const runtime = await startRuntime();
    try {
        await runMainFlow(runtime);
        await runValidation(runtime, captureCheckpoint);
        await runErrorScenario(runtime, '429', 429, false, captureCheckpoint);
        await runErrorScenario(runtime, '503', 503, false, captureCheckpoint);
        await runErrorScenario(runtime, 'upload-400.pdf', 400, true, captureCheckpoint);
        await runErrorScenario(runtime, 'upload-413.pdf', 413, true, captureCheckpoint);
        console.log('Editor safety browser flow passed. Providers were not called; external requests were aborted.');
    } finally {
        await runtime.close();
    }
}

if (require.main === module) {
    run().then(() => process.exit(0)).catch((error) => {
        console.error(error.stack || error);
        process.exit(1);
    });
}

module.exports = { checkpoint: captureCheckpoint, requestTopic, outlineCount, startPresentation, getEditorFrame, runMainFlow };
