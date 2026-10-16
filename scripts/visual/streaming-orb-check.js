/* global window, document, getComputedStyle, OffscreenCanvas, MutationObserver */
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
    await checkModeTransitions(page, width, theme, output);
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
            const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('.preview-stream-orb canvas'));
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

// Hold only the geometry still: the adapter's real RAF/monotonic clock keeps
// running, so pixel differences measure the fade rather than particle rotation.
async function sampleModeTransition({ interrupt }) {
    const engine = await import(new URL('/features/chat/thinking-orbs-engine.js', window.location.href).href);
    const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('.preview-stream-orb canvas'));
    const original = { ...engine.MODE_FRAMES };
    const times = {}, rewinds = [], sizeChanges = [];
    const speeds = Object.fromEntries(Object.keys(engine.STATE_TO_MODE).map(state => {
        const preset = engine.resolvePreset(state, 64); return [preset.mode, preset.speed];
    }));
    for (const mode of Object.keys(original)) engine.MODE_FRAMES[mode] = (size, time, options) => {
        const clock = time / speeds[mode];
        if (clock < (times[mode] ?? 0)) rewinds.push(mode);
        times[mode] = clock;
        return original[mode](size, 3, options);
    };
    const sampler = new OffscreenCanvas(96, 96).getContext('2d');
    let previous;
    const frames = [];
    const observer = new MutationObserver(records => sizeChanges.push(records.length));
    let startedAt = 0;
    function sample() {
        sampler.clearRect(0, 0, 96, 96);
        sampler.drawImage(canvas, 0, 0, 96, 96);
        const pixels = sampler.getImageData(0, 0, 96, 96).data;
        let delta = 0;
        if (previous) for (let index = 0; index < pixels.length; index += 4) {
            delta += Math.abs(pixels[index + 3] - previous[index + 3]);
            for (let channel = 0; channel < 3; channel += 1) {
                delta += Math.abs(pixels[index + channel] * pixels[index + 3] / 255
                    - previous[index + channel] * previous[index + 3] / 255);
            }
        }
        previous = pixels;
        const frame = { at: performance.now() - startedAt, delta: delta / pixels.length, png: canvas.toDataURL() };
        frames.push(frame);
        return frame;
    }
    try {
        window.AedosOrbs.setPreviewState('content');
        await new Promise(resolve => setTimeout(resolve, 650));
        observer.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
        const bounds = canvas.getBoundingClientRect().toJSON();
        startedAt = performance.now();
        sample();
        window.AedosOrbs.setPreviewState('design');
        const immediate = sample().delta;
        let interruption = 0;
        await new Promise(resolve => {
            let count = 0;
            const timer = setInterval(() => {
                sample();
                count += 1;
                if (interrupt && count === 4) {
                    window.AedosOrbs.setPreviewState(interrupt);
                    interruption = sample().delta;
                }
                if (count === 18) { clearInterval(timer); resolve(null); }
            }, 50);
        });
        return { frames, immediate, interruption, rewinds, sizeChanges,
            sameCanvas: canvas === document.querySelector('.preview-stream-orb canvas'),
            bounds, finalBounds: canvas.getBoundingClientRect().toJSON() };
    } finally {
        Object.assign(engine.MODE_FRAMES, original);
        observer.disconnect();
    }
}

async function checkModeTransitions(page, width, theme, output) {
    const results = [];
    for (const kind of ['normal', 'interrupted', 'reversed', 'reduced']) {
        const reduced = kind === 'reduced';
        if (page.emulateMedia) await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
        else await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
        const interrupt = { interrupted: 'compositing', reversed: 'content' }[kind];
        const result = await page.evaluate(sampleModeTransition, { interrupt });
        const deltas = result.frames.slice(2).map(frame => frame.delta);
        const total = deltas.reduce((sum, value) => sum + value, 0);
        const label = `${width}/${theme}/${kind}`;
        assert.deepEqual(result.rewinds, [], `Mode clocks must never restart: ${label}`);
        assert.deepEqual(result.sizeChanges, [], `Mode changes must not reallocate the buffer: ${label}`);
        assert.equal(result.sameCanvas, true, label);
        assert.deepEqual(result.bounds, result.finalBounds, `No position/scale jump: ${label}`);
        if (reduced) {
            assert.ok(result.immediate > .1, `Reduced motion must switch immediately: ${label}`);
            assert.equal(total, 0, `Reduced motion must not animate: ${label}`);
        } else {
            assert.equal(result.immediate, 0, `First paint must preserve the previous mode: ${label}`);
            assert.ok(deltas.filter(value => value > .01).length >= 7, `Fade must span multiple 50ms frames: ${label}`);
            assert.ok(Math.max(...deltas) < total * .3, `No single large pixel jump: ${label}: ${JSON.stringify(deltas)}`);
            assert.ok(result.interruption <= Math.max(...deltas), `Interrupted fade must retain its current blend: ${label}`);
            assert.ok(deltas.slice(-2).every(value => value === 0), `Fade must finish within 600ms: ${label}`);
        }
        result.frames.forEach((frame, index) => {
            fs.writeFileSync(path.join(output, `transition-${width}-${theme}-${kind}-${index}.png`), Buffer.from(frame.png.split(',')[1], 'base64'));
            delete frame.png;
        });
        results.push({ kind, ...result });
    }
    if (page.emulateMedia) await page.emulateMedia({ reducedMotion: 'no-preference' });
    else await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    fs.writeFileSync(path.join(output, `transitions-${width}-${theme}.json`), JSON.stringify(results, null, 2));
}

module.exports = { checkLoadingStates, checkModeTransitions, luminance };
