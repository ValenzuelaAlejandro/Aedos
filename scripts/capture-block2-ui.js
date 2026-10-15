'use strict';

/* global window, document, getComputedStyle */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

process.env.NODE_ENV = 'test';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
process.env.GEMINI_API_KEY = 'block2-visual-test';
require('dotenv').config = () => ({ parsed: {} });
const { app } = require('../src/backend/server');
const models = Object.values(require('../src/backend/config/model-catalog').MODEL_CATALOG);
const outputDir = path.resolve('docs/evidence/block2');
const executablePath = path.resolve(
    'puppeteer-cache/chrome-headless-shell/win64-146.0.7680.76/chrome-headless-shell-win64/chrome-headless-shell.exe',
);
fs.mkdirSync(outputDir, { recursive: true });

function deferred() {
    let release;
    const promise = new Promise((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

async function configure(page, origin, loadingGate, usageState) {
    let usageRequests = 0;
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
        const url = new URL(request.url());
        if (url.origin !== origin)
            return ['script', 'stylesheet', 'font'].includes(request.resourceType())
                ? request.continue()
                : request.abort();
        if (url.pathname === '/api/usage') {
            usageRequests += 1;
            if (usageRequests === 1) await loadingGate.promise;
            return request.respond({
                status: 200,
                contentType: 'application/json',
                headers: { 'Cache-Control': 'no-store' },
                body: JSON.stringify({
                    dailyUnits: 50_000,
                    remainingUnits: usageState.remainingUnits,
                    resetsAt: '2026-10-16T00:00:00.000Z',
                    geminiAvailable: true,
                    paidPaused: false,
                    spendPaused: usageState.spendPaused,
                }),
            });
        }
        if (url.pathname === '/api/models')
            return request.respond({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ models, paymentsPaused: false }),
            });
        const headers = { ...request.headers() };
        delete headers.origin;
        return request.continue({ headers });
    });
}

async function capture(page, file) {
    await page.mouse.move(4, 4);
    await new Promise(resolve => setTimeout(resolve, 200));
    await page.screenshot({ path: path.join(outputDir, file), fullPage: false });
}

// eslint-disable-next-line max-lines-per-function -- One viewport scenario verifies loading, budget affordability, paused state, and chat locks in the captured browser session.
async function checkViewport(origin, width, theme) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', (error) =>
        console.error(`browser error (${width}/${theme}):`, error.message),
    );
    const loadingGate = deferred();
    const usageState = { spendPaused: false, remainingUnits: 50_000 };
    await configure(page, origin, loadingGate, usageState);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () => window.AedosCreditsUI && document.getElementById('credits-balance-trigger'),
    );
    await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
    );
    await page.waitForFunction(
        () =>
            document.getElementById('credits-balance-trigger').getAttribute('aria-busy') === 'true',
    );
    const loading = await page.$eval('#credits-balance-trigger', (node) => ({
        state: node.dataset.state,
        busy: node.getAttribute('aria-busy'),
    }));
    assert.equal(loading.busy, 'true');
    await capture(page, `usage-loading-${width}-${theme}.png`);

    loadingGate.release();
    await page.waitForFunction(
        () => document.getElementById('credits-balance-trigger').dataset.state === 'ready',
    );
    await page.$eval(
        '#w-tema',
        (node, value) => {
            node.value = value;
            node.dispatchEvent(new Event('input', { bubbles: true }));
        },
        'Presentación de prueba sobre energía solar',
    );
    const ready = await page.evaluate(() => ({
        balance: document.getElementById('credits-balance').textContent,
        quote: document.getElementById('credits-cost-preview').textContent,
        reset: document.getElementById('credits-reset-time').textContent,
        buttonEnabled: !document.querySelector('#btn-generate')?.matches(':disabled'),
        statusHidden: document.getElementById('credits-status').hidden,
        statusText: document.getElementById('credits-status').textContent,
    }));
    assert.match(ready.balance, /100%/);
    assert.match(ready.quote, /25\.6%/);
    assert.ok(ready.reset.length > 0 && ready.buttonEnabled);
    assert.equal(ready.statusHidden, true);
    assert.equal(ready.statusText, '');
    await capture(page, `usage-ready-${width}-${theme}.png`);
    await page.click('#slide-count-trigger');
    await capture(page, `slider-flash-${width}-${theme}.png`);
    await page.click('#slide-count-trigger');

    await page.click('#generation-mode-toggle');
    const affordablePro = await page.evaluate(() => {
        window.AedosCreditsUI.setSlideCount(15);
        const slider = /** @type {HTMLInputElement|null} */ (
            document.getElementById('slide-count-select')
        );
        return {
            max: slider?.max,
            value: slider?.value,
            quote: document.getElementById('credits-cost-preview').textContent,
        };
    });
    assert.equal(affordablePro.max, '15');
    assert.equal(affordablePro.value, '15');
    assert.match(affordablePro.quote, /^96%/);
    await page.click('#slide-count-trigger');
    await capture(page, `slider-pro-${width}-${theme}.png`);
    await page.click('#slide-count-trigger');
    const { createMemoryCreditsLedger } = require('../src/backend/utils/credits-ledger');
    const { quoteModel } = require('../src/backend/http/middleware/generation-credits');
    const ledger = createMemoryCreditsLedger();
    const charged = quoteModel(models.find(model => model.brand === 'gemini'), 15, 15, 'pro');
    const reservation = await ledger.reserve('capture-user', charged, 'successful-deck');
    await ledger.commit(reservation, charged);
    usageState.remainingUnits = await ledger.getRemaining('capture-user');
    await page.evaluate(async () => window.AedosCreditsUI.refresh());
    const lowBalance = await page.evaluate(() => ({
        max: document.getElementById('slide-count-select').getAttribute('max'),
        sliderDisabled: document.getElementById('slide-count-select').matches(':disabled'),
        remaining: window.AedosCreditsUI.getRemainingPercent(),
        enabled: !document.querySelector('#btn-generate').matches(':disabled'),
    }));
    assert.deepEqual(lowBalance, { max: '1', sliderDisabled: true, remaining: '4%', enabled: false });
    await capture(page, `usage-insufficient-${width}-${theme}.png`);
    await page.evaluate(() => window.AedosConversation.begin());
    const chatMargin = await page.evaluate(() => ({
        status: document.getElementById('credits-status').textContent,
        disabled: document.getElementById('btn-generate').matches(':disabled'),
        quote: window.AedosCreditsUI.getQuote().total,
    }));
    assert.equal(chatMargin.disabled, true);
    assert.equal(chatMargin.quote, models.find(model => model.brand === 'gemini').chatReservationUnits.pro);
    assert.match(chatMargin.status, /4%/);
    assert.match(chatMargin.status, /reserv/i);
    await capture(page, `chat-margin-${width}-${theme}.png`);
    await page.evaluate(() => {
        sessionStorage.removeItem('aedos.conversation.active.v1');
    });
    // Reload resets the in-memory conversation lock as a user starting a new conversation does.
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.AedosCreditsUI?.getBalance() === 2000);
    usageState.remainingUnits = 50_000;
    await page.evaluate(async () => window.AedosCreditsUI.refresh());
    if (await page.evaluate(() => window.AedosStores.generation.state.proModeEnabled)) await page.click('#generation-mode-toggle');
    await page.evaluate(() => {
        window.AedosCreditsUI.setSlideCount(8);
    });

    usageState.spendPaused = true;
    await page.evaluate(async () => window.AedosCreditsUI.refresh());
    await page.waitForFunction(
        () =>
            !document.getElementById('credits-status').hidden &&
            document.getElementById('credits-status').dataset.state === 'paused',
    );
    const paused = await page.$eval('#credits-status', (node) => node.textContent);
    assert.match(paused, /AI budget|presupuesto de IA/i);
    assert.equal(await page.$eval('#btn-generate', (node) => node.disabled), true);
    await capture(page, `usage-cap-${width}-${theme}.png`);

    usageState.spendPaused = false;
    await page.evaluate(async () => window.AedosCreditsUI.refresh());
    await page.waitForFunction(() => document.getElementById('credits-status').hidden);
    await page.evaluate(() => window.AedosConversation.begin());
    const lock = await page.evaluate(() => ({
        modelDisabled: document.querySelector('#btn-model-dropdown')?.matches(':disabled'),
        modeDisabled: document.querySelector('#generation-mode-toggle')?.matches(':disabled'),
        languageDisabled: document.querySelector('#btn-lang-dropdown')?.matches(':disabled'),
        newConversationVisible: !document.getElementById('new-conversation-btn').hidden,
        sliderHidden:
            getComputedStyle(document.querySelector('.slide-count-control')).display === 'none',
    }));
    assert.deepEqual(lock, {
        modelDisabled: true,
        modeDisabled: true,
        languageDisabled: false,
        newConversationVisible: true,
        sliderHidden: true,
    });
    await capture(page, `conversation-lock-${width}-${theme}.png`);
    await page.close();
    return { width, theme, loading, ready, affordablePro, lowBalance, chatMargin, paused, lock };
}

let server;
let browser;
(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Local screenshot server did not bind a TCP port.');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await puppeteer.launch({ headless: true, executablePath });
    const checks = [];
    for (const width of [390, 1440])
        for (const theme of ['light', 'dark']) {
            checks.push(await checkViewport(origin, width, theme));
        }
    fs.writeFileSync(path.join(outputDir, 'checks.json'), JSON.stringify(checks, null, 2) + '\n');
    console.log(JSON.stringify(checks, null, 2));
})()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await browser?.close();
        server?.closeAllConnections();
        if (server) await new Promise((resolve) => server.close(resolve));
    })
    .then(() => process.exit(process.exitCode || 0));
