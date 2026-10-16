/* global window, document, getComputedStyle */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function luminance(color) {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const normalized = value / 255;
        return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

async function checkLoadingStates(page, width, theme, output, capture) {
    const loadingStates = [];
    for (const state of ['analyze', 'slides', 'retry']) {
        await page.evaluate(labelKey => {
            document.getElementById('preview-stream-status-text').textContent = window.AedosStreamRetry.text('es', labelKey);
            window.AedosOrbs.setPreviewState(labelKey === 'analyze' ? 'content' : 'flash');
        }, state);
        const hashes = [];
        for (let frame = 0; frame < 5; frame += 1) {
            if (frame) await new Promise(resolve => setTimeout(resolve, 500));
            const png = await page.$eval('.preview-stream-orb canvas', canvas => canvas.toDataURL());
            const pixels = Buffer.from(png.split(',')[1], 'base64');
            hashes.push(createHash('sha256').update(pixels).digest('hex'));
            fs.writeFileSync(path.join(output, `orb-${width}-${theme}-${state}-${frame}.png`), pixels);
        }
        assert.equal(new Set(hashes).size, 5, `Orb must animate across five 500ms frames: ${width}/${theme}/${state}`);
        const layout = await page.evaluate(() => {
            const canvas = document.querySelector('.preview-stream-orb canvas');
            const orb = canvas.getBoundingClientRect();
            const status = document.getElementById('preview-stream-status');
            const text = status.getBoundingClientRect();
            const wrapper = document.querySelector('.preview-wrapper');
            return { width: orb.width, height: orb.height, bitmapWidth: canvas.width, bitmapHeight: canvas.height,
                gap: text.top - orb.bottom, textRight: text.right, viewport: window.innerWidth, dpr: window.devicePixelRatio,
                color: getComputedStyle(status).color, background: getComputedStyle(wrapper).backgroundColor,
                pageBackground: getComputedStyle(document.getElementById('preview-container')).backgroundColor,
                stageBackground: getComputedStyle(document.getElementById('preview-stage')).backgroundColor,
                textPosition: getComputedStyle(status).position };
        });
        assert.ok(layout.width > 0 && Math.abs(layout.width - layout.height) < 1, JSON.stringify(layout));
        assert.equal(layout.bitmapWidth, layout.bitmapHeight);
        assert.ok(Math.abs(layout.bitmapWidth - layout.width * layout.dpr) <= 1, JSON.stringify(layout));
        assert.ok(layout.gap >= 12 && layout.gap <= 17, `Text must sit below and never intersect the orb: ${JSON.stringify(layout)}`);
        assert.equal(layout.textPosition, 'static');
        assert.ok(layout.textRight <= layout.viewport, JSON.stringify(layout));
        assert.equal(layout.background, layout.pageBackground, 'Loading background must be uniform');
        assert.equal(layout.stageBackground, layout.pageBackground, 'The full loading area must match the page');
        const textLuminance = luminance(layout.color), surfaceLuminance = luminance(layout.background);
        assert.ok((Math.max(textLuminance, surfaceLuminance) + .05) / (Math.min(textLuminance, surfaceLuminance) + .05) >= 4.5);
        await capture(page, `loading-${state}-${width}-${theme}`);
        loadingStates.push({ state, hashes, layout });
    }
    return loadingStates;
}

module.exports = { checkLoadingStates, luminance };
