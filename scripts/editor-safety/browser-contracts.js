/* global DataTransfer, document, window */
const assert = require('node:assert/strict');

/** @typedef {import('puppeteer').Page} BrowserPage */

const requiredIds = [
    'chat-screen', 'w-tema', 'btn-generate', 'outline-container', 'outline-slides-container',
    'outline-suggested-chips', 'btn-outline-add-slide', 'btn-outline-generate', 'preview-container',
    'preview-iframe', 'btn-undo', 'btn-redo', 'btn-zoom-in', 'btn-zoom-out', 'canvas-zoom-display',
    'editor-minimap', 'minimap-list', 'theme-toggle-btn', 'btn-lang-dropdown',
    'error-container', 'error-message', 'export-menu-trigger', 'finalize-btn', 'export-pptx-btn',
];
const requiredGlobals = [
    'initOutlineEditor', 'deleteSlide', 'moveSlideUp', 'moveSlideDown',
    'proceedWithCurrentOutline', 'startFinalGeneration', 'initTools', 'initMinimap',
];

async function assertDomContract(page) {
    const result = await page.evaluate(({ ids, globals }) => ({
        missingIds: ids.filter((id) => !document.getElementById(id)),
        missingGlobals: globals.filter((name) => typeof window[name] !== 'function'),
    }), { ids: requiredIds, globals: requiredGlobals });
    assert.deepEqual(result.missingIds, [], 'DOM IDs used by the frontend contract disappeared');
    assert.deepEqual(result.missingGlobals, [], 'window compatibility bridge disappeared');
}

async function requestTopic(page, topic) {
    await page.locator('#w-tema').fill(topic);
    await page.click('#btn-generate');
}

async function outlineCount(page) {
    return page.$$eval('#outline-slides-container .seamless-slide-item', (items) => items.length);
}

function assertMainFlowTrace(trace) {
    const paths = trace.map((entry) => entry.path);
    assert.deepEqual(paths.filter((name) => ['/generate-skeleton', '/generate', '/finalize', '/finalize-pptx'].includes(name)), [
        '/generate-skeleton', '/generate', '/finalize', '/finalize-pptx',
    ], 'mocked endpoint sequence is a stable browser contract');
    const sseOrder = trace.filter((entry) => entry.events).flatMap((entry) => entry.events);
    assert.deepEqual(sseOrder, ['chunk', 'done', 'chunk', 'done'], 'SSE event order changed');
    assert.equal(trace.find((entry) => entry.path === '/generate-skeleton')?.languageJa, true,
        'Japanese language selection was not serialized into the skeleton request');
}

async function runErrorScenario(runtime, name, status, withFile, checkpoint) {
    runtime.setPlans([{ status, type: 'application/json', body: JSON.stringify({ error: `MOCK_HTTP_${status}` }) }]);
    const page = await runtime.newPage();
    try {
        if (withFile) {
            await page.$eval('#file-upload-input', (input, fileName) => {
                const files = new DataTransfer();
                files.items.add(new File(['stub'], fileName, { type: 'application/pdf' }));
                input.files = files.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }, name);
        }
        await requestTopic(page, withFile ? `Upload ${name}` : `Error path ${status}`);
        await page.waitForFunction(() => !document.getElementById('error-container')?.classList.contains('hidden'), { timeout: 10000 });
        await checkpoint(page, `flow-error-${name}`, async () => {
            assert.equal(await page.$eval('#error-message', (el) => el.textContent), `MOCK_HTTP_${status}`);
        });
    } finally {
        await page.close();
    }
}

async function runValidation(runtime, checkpoint) {
    const page = await runtime.newPage();
    try {
        await checkpoint(page, 'flow-validation-empty-topic', async () => {
            assert.equal(await page.$eval('#btn-generate', (el) => el.disabled), true);
            assert.equal(await page.$eval('#w-tema', (el) => el.value), '');
        });
    } finally {
        await page.close();
    }
}

module.exports = {
    requiredIds,
    requiredGlobals,
    assertDomContract,
    requestTopic,
    outlineCount,
    assertMainFlowTrace,
    runErrorScenario,
    runValidation,
};
