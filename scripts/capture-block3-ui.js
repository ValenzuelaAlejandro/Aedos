'use strict';

/* global window, document */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

process.env.NODE_ENV = 'test';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
process.env.GEMINI_API_KEY = 'ui-local-stub';
require('dotenv').config = () => ({ parsed: {} });
const { app } = require('../src/backend/server');
const outputDir = path.resolve('docs/evidence/block3');
const executablePath = path.resolve('puppeteer-cache/chrome-headless-shell/win64-146.0.7680.76/chrome-headless-shell-win64/chrome-headless-shell.exe');
fs.mkdirSync(outputDir, { recursive: true });

async function prepare(page, origin, width, theme) {
    await page.setViewport({ width, height: 920, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin !== origin) return ['script', 'stylesheet', 'font'].includes(request.resourceType())
            ? request.continue() : request.abort();
        if (url.pathname === '/api/credits') return request.respond({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ daily: 50, remaining: 50, geminiAvailable: true }) });
        if (url.pathname === '/api/models') return request.respond({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ models: Object.values(require('../src/backend/config/model-catalog').MODEL_CATALOG), paymentsPaused: false }) });
        const headers = { ...request.headers() };
        delete headers.origin;
        return request.continue({ headers });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AedosCreditsUI && document.getElementById('slide-count-select')
        && document.getElementById('credits-balance-trigger')?.dataset.state === 'ready');
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    await new Promise(resolve => setTimeout(resolve, 60));
}

async function captureMode(page, width, theme, mode) {
    const currentlyPro = await page.$eval('#generation-mode-toggle', element => element.getAttribute('aria-checked') === 'true');
    if (currentlyPro !== (mode === 'pro')) await page.click('#generation-mode-toggle');
    const expectedMax = mode === 'pro' ? '15' : '8';
    assert.equal(await page.$eval('#slide-count-select', element => element.max), expectedMax);
    assert.equal(await page.$$eval('#slide-count-ticks .slide-count-tick', ticks => ticks.length), Number(expectedMax));
    await page.$eval('#slide-count-select', (element, value) => {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }, expectedMax);
    assert.equal(await page.$eval('#slide-count-select', element => element.value), expectedMax);
    await page.click('#slide-count-trigger');
    if (mode === 'flash') {
        const notice = await page.$eval('#slide-count-mode-notice', element => ({ visible: !element.hidden, text: element.textContent }));
        assert.equal(notice.visible, true);
        assert.match(notice.text, /Flash.*8/i);
    }
    const file = `block3-${mode}-${width}-${theme}.png`;
    await page.screenshot({ path: path.join(outputDir, file), fullPage: false });
    await page.click('#slide-count-trigger');
}

(async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local capture server did not bind a TCP port.');
    const { port } = address;
    const origin = `http://127.0.0.1:${port}`;
    const browser = await puppeteer.launch({ headless: true, executablePath });
    const checks = [];
    try {
        for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
            const page = await browser.newPage();
            await prepare(page, origin, width, theme);
            await captureMode(page, width, theme, 'pro');
            await captureMode(page, width, theme, 'flash');
            checks.push({ width, theme, proMax: 15, flashMax: 8, visibleTickCounts: { pro: 15, flash: 8 }, clampNotice: 'visible' });
            await page.close();
        }
        fs.writeFileSync(path.join(outputDir, 'checks.json'), JSON.stringify(checks, null, 2));
        console.log(JSON.stringify(checks, null, 2));
    } finally {
        await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    process.exit(0);
})().catch(error => { console.error(error); process.exitCode = 1; });
