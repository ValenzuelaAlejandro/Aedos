/* global document, requestAnimationFrame */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { comparePngBuffers } = require('../visual-baseline-utils');
const { root } = require('./runtime');

/** @typedef {import('puppeteer').Page} BrowserPage */
/** @typedef {{ hideMinimap?: boolean }} CheckpointOptions */
/** @typedef {(page: BrowserPage, name: string, assertion: () => Promise<void>, options?: CheckpointOptions) => Promise<void>} Checkpoint */

const updating = process.argv.includes('--update');
const baselineDir = path.join(root, 'tests/baseline/editor-safety');
const outputDir = updating ? baselineDir : path.join(root, 'tmp/editor-safety-current');
const visual = JSON.parse(fs.readFileSync(path.join(root, 'tests/baseline/visual-config.json'), 'utf8'));

async function settleMinimapThumbnails(page) {
    await page.waitForFunction(() => {
        const preview = document.getElementById('preview-container');
        if (!preview || preview.classList.contains('hidden')) return true;
        const frames = [...document.querySelectorAll('#minimap-list iframe')]
            .map((frame) => /** @type {HTMLIFrameElement} */ (frame));
        return preview.classList.contains('is-editor-ready') && frames.length > 0 && frames.every((frame) => {
            const doc = frame.contentDocument;
            return doc?.readyState === 'complete' && doc.querySelector('section.s') && doc.fonts?.status !== 'loading';
        });
    }, { timeout: 10000 });
}

/** @type {Checkpoint} */
async function checkpoint(page, name, assertion, options = {}) {
    await assertion();
    await settleMinimapThumbnails(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const minimapSuppression = options.hideMinimap
        ? await page.addStyleTag({ content: '#editor-minimap { visibility: hidden !important; }' })
        : null;
    let image;
    try {
        image = await page.screenshot({ type: 'png', fullPage: false });
    } finally {
        if (minimapSuppression) await minimapSuppression.evaluate((style) => style.remove());
    }
    const imagePath = path.join(outputDir, `${name}.png`);
    if (updating) {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(imagePath, image);
        console.log(`${name}: baseline written (${image.length} bytes)`);
        return;
    }
    const expected = fs.readFileSync(path.join(baselineDir, `${name}.png`));
    const comparison = comparePngBuffers(expected, image, visual.comparison);
    console.log(`${name}: ${comparison.differentPixels} pixels (${(comparison.ratio * 100).toFixed(4)}%), max region RGB ${comparison.maxRegionDistance.toFixed(1)}`);
    if (!comparison.passed) {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, `${name}-actual.png`), image);
        fs.writeFileSync(path.join(outputDir, `${name}-diff.png`), comparison.diffBuffer);
        assert.fail(`Visual safety checkpoint differs: ${name}; region=${comparison.maxRegion.x},${comparison.maxRegion.y}`);
    }
}

module.exports = { checkpoint };
