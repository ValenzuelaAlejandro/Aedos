/* global window, document, getComputedStyle */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
function deferred() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

process.env.NODE_ENV = 'test';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
process.env.GEMINI_API_KEY = 'ui-local-stub';
require('dotenv').config = () => ({ parsed: {} });
const { app, setTestProviderOverride, clearTestProviderOverride } = require('../src/backend/server');
const models = Object.values(require('../src/backend/config/model-catalog').MODEL_CATALOG);
const output = path.resolve('test-evidence/block4');
fs.mkdirSync(output, { recursive: true });
const skeleton = { topic: 'Energía solar', language: 'es', slide_count: 2, tone: 'academic', audience: 'general',
    slides: [{ index: 1, role: 'cover', title: 'Esquema completo', key_points: ['Energía limpia'] },
        { index: 2, role: 'conclusion', title: 'Aplicaciones', key_points: ['Futuro sostenible'] }] };
let scenario;

setTestProviderOverride(({ stageName }) => ({ provider: 'test', model: 'same-model-stub', stream: (async function* () {
    const chat = stageName === 'Stage1';
    const phase = scenario;
    yield { type: 'reasoning', text: 'Analizando el contenido de energía solar.' };
    yield chat ? JSON.stringify({ ...skeleton, topic: 'FAILED CHAT', slides: [{ title: 'FAILED CHAT', key_points: ['Discard'] }] })
        : '<html><head><style>section.s{width:1122px;height:631px;background:#eee;color:#111}</style></head><body><section class="s"><h1>FAILED SLIDE</h1></section>';
    await phase.partial.promise;
    yield { type: 'reset', stage: chat ? 'Stage1' : 'Flash', attempt: 1 };
    await phase.retry.promise;
    const content = chat ? JSON.stringify(skeleton)
        : '<html><head><style>section.s{width:1122px;height:631px;background:#f2eee7;color:#24221f;font:48px Georgia;padding:70px;box-sizing:border-box}</style></head><body><section class="s"><h1>Presentación completa</h1><p>Energía solar</p></section></body></html>';
    yield content.slice(0, Math.floor(content.length * .8));
    await phase.finish.promise;
    yield content.slice(Math.floor(content.length * .8));
})() }));

function gates() { return { partial: deferred(), retry: deferred(), finish: deferred() }; }
async function capture(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false }); }
function luminance(color) {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const normalized = value / 255;
        return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function readHeaderGeometry() {
    const mode = document.getElementById('generation-mode-toggle').getBoundingClientRect();
    const button = document.getElementById('btn-lang-dropdown').getBoundingClientRect();
    const icon = document.querySelector('#btn-lang-dropdown > svg:first-child').getBoundingClientRect();
    const topPanel = document.querySelector('.top-control-panel').getBoundingClientRect();
    const topControls = [...document.querySelector('.top-controls').children].map(element => {
        const rect = element.getBoundingClientRect();
        return { name: element.id || element.className, left: rect.left, right: rect.right, width: rect.width };
    });
    const supportLink = document.querySelector('.home-donation-link');
    const creditsPercent = document.getElementById('credits-balance-percent');
    const discord = document.getElementById('discord-community-link');
    return { overlap: mode.right > button.left && mode.left < button.right && mode.bottom > button.top && mode.top < button.bottom,
        centerError: Math.abs(button.left + button.width / 2 - icon.left - icon.width / 2),
        iconVerticalCenterError: Math.abs(button.top + button.height / 2 - icon.top - icon.height / 2),
        topPanelLeft: topPanel.left, topPanelRight: topPanel.right,
        creditsPercent: creditsPercent?.textContent || '', supportAccessibleName: supportLink?.getAttribute('aria-label') || '',
        discordHidden: getComputedStyle(discord).display === 'none', topControls };
}

async function configureRequests(page, origin, creditGate) {
    let creditCalls = 0;
    await page.setRequestInterception(true);
    page.on('request', async req => {
        const url = new URL(req.url());
        if (url.origin !== origin) return ['script', 'stylesheet', 'font'].includes(req.resourceType()) ? req.continue() : req.abort();
        if (url.pathname === '/api/usage') {
            if (++creditCalls === 1) return req.respond({ status: 503, contentType: 'application/json', body: '{}' });
            await creditGate.promise;
            return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ dailyUnits: 50000, remainingUnits: 50000,
                geminiAvailable: true, paidPaused: false, spendPaused: false, resetsAt: new Date(Date.now() + 3600000).toISOString() }) });
        }
        if (url.pathname === '/api/models') return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ models, paymentsPaused: false }) });
        const headers = { ...req.headers() }; delete headers.origin;
        return req.continue({ headers });
    });
}

async function check(page, origin, width, theme) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    const creditGate = deferred();
    await configureRequests(page, origin, creditGate);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AedosCreditsUI && window.startFinalGeneration);
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    await page.waitForFunction(() => document.getElementById('credits-balance-trigger').dataset.state === 'retrying');
    await page.type('#w-tema', 'Explica la energía solar');
    await page.waitForFunction(() => document.getElementById('credits-balance-trigger').getAttribute('aria-busy') === 'true');
    assert.ok(await page.$eval('#credits-status', e => !e.hidden && e.textContent.length > 0));
    await capture(page, `credits-${width}-${theme}`);
    creditGate.release();
    await page.evaluate(() => window.AedosCreditsUI.refresh());
    await page.waitForFunction(() => document.getElementById('credits-balance-trigger').getAttribute('aria-busy') === 'false');
    assert.ok(await page.$eval('#credits-status', node => node.hidden && node.textContent === ''));
    const header = await page.evaluate(readHeaderGeometry);
    assert.equal(header.overlap, false); if (width <= 430) assert.ok(header.centerError <= 1);
    assert.ok(header.iconVerticalCenterError <= 1, JSON.stringify({ width, header }));
    assert.match(header.creditsPercent, /^\d+(?:\.\d+)?%$/);
    assert.ok(header.supportAccessibleName);
    if (width <= 430) {
        assert.ok(header.discordHidden);
        for (const control of header.topControls.filter(item => item.width > 0)) {
            assert.ok(control.left >= header.topPanelLeft - 1 && control.right <= header.topPanelRight + 1,
                JSON.stringify({ width, header, control }));
        }
    }
    await page.evaluate(() => { window.AedosStores.generation.state.targetLanguage = 'es'; });
    // Keep the harness outline and user request aligned with Block 3's exact
    // slide-count contract; the slider starts at 8 by default.
    await page.evaluate(() => window.AedosCreditsUI.setSlideCount(2));
    scenario = gates();
    await page.click('#btn-generate');
    await page.waitForFunction(() => [...document.querySelectorAll('.outline-slide-title')].some(e => /** @type {HTMLTextAreaElement} */(e).value.includes('FAILED CHAT')));
    assert.equal(await page.evaluate(() => window.outlineEditorState.skeleton), null);
    scenario.partial.release();
    await page.waitForFunction(() => [...document.querySelectorAll('.chat-thinking-status-text')].some(e => e.textContent === 'Reintentando...'));
    assert.ok(!await page.evaluate(() => [...document.querySelectorAll('.outline-slide-title')].some(e => /** @type {HTMLTextAreaElement} */(e).value.includes('FAILED CHAT'))));
    const chatControls = await page.evaluate(() => {
        const language = document.getElementById('btn-lang-dropdown').getBoundingClientRect();
        const slides = document.getElementById('slide-count-trigger').getBoundingClientRect();
        return { languageRight: language.right, slidesLeft: slides.left,
            gap: getComputedStyle(document.querySelector('.chat-actions-left')).gap,
            modelWidth: document.getElementById('btn-model-dropdown').getBoundingClientRect().width,
            overlaps: language.right > slides.left && Math.abs(language.top - slides.top) < 20 };
    });
    assert.equal(chatControls.overlaps, false, JSON.stringify({ width, chatControls }));
    await capture(page, `chat-retry-${width}-${theme}`);
    scenario.retry.release();
    await page.waitForFunction(() => [...document.querySelectorAll('.chat-thinking-status-text')].some(e => e.textContent === 'Creando esquema…'));
    scenario.finish.release();
    await page.waitForFunction(() => window.outlineEditorState.skeleton?.slides?.length === 2);
    scenario = gates();
    await page.evaluate(s => { window.__uiGeneration = window.startFinalGeneration(s); }, skeleton);
    await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.body?.textContent.includes('FAILED SLIDE'));
    scenario.partial.release();
    await page.waitForFunction(() => document.getElementById('preview-stream-status-text').textContent === 'Reintentando...');
    await page.waitForFunction(() => !document.querySelector('iframe').contentDocument?.body?.textContent.includes('FAILED SLIDE'));
    await page.waitForFunction(() => document.getElementById('chat-screen').classList.contains('hidden') && getComputedStyle(document.getElementById('preview-container')).opacity === '1');
    const geometry = await page.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        const status = document.getElementById('preview-stream-status-text');
        return { canvas: box('.preview-wrapper'), orb: box('.preview-stream-orb-overlay'), status: box('#preview-stream-status'),
            color: getComputedStyle(status).color, background: getComputedStyle(document.querySelector('.preview-wrapper')).backgroundColor };
    });
    assert.ok(geometry.orb.x >= geometry.canvas.x - 1 && geometry.orb.y >= geometry.canvas.y - 1);
    assert.ok(geometry.orb.x + geometry.orb.w <= geometry.canvas.x + geometry.canvas.w + 1);
    assert.ok(geometry.orb.y + geometry.orb.h <= geometry.canvas.y + geometry.canvas.h + 1);
    assert.ok(geometry.status.y >= geometry.canvas.y && geometry.status.y + geometry.status.h <= geometry.canvas.y + geometry.canvas.h + 1);
    const foreground = luminance(geometry.color), background = luminance(geometry.background);
    const contrast = (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    assert.ok(contrast >= 4.5, `Retry label contrast ${contrast}`);
    await capture(page, `presentation-retry-${width}-${theme}`);
    scenario.retry.release();
    await page.waitForFunction(() => document.getElementById('preview-stream-status-text').textContent !== 'Reintentando...');
    scenario.finish.release();
    await page.evaluate(() => window.__uiGeneration);
    await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.body?.textContent.includes('Presentación completa'));
    assert.ok(!await page.evaluate(() => document.querySelector('iframe').contentDocument.body.textContent.includes('FAILED')));
    return { width, theme, header, chatControls, geometry, contrast, liveChat: true, discardedChatDraft: true, discardedSlides: true, retryTextRestored: true };
}

(async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const address = /** @type {import('node:net').AddressInfo} */ (server.address());
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = await puppeteer.launch({ headless: true, executablePath: path.resolve('puppeteer-cache/chrome-headless-shell/win64-146.0.7680.76/chrome-headless-shell-win64/chrome-headless-shell.exe') });
    const results = [];
    try {
        const widthsArgument = process.argv.find(value => value.startsWith('--widths='));
        const widths = widthsArgument ? widthsArgument.slice(9).split(',').map(Number) : [390, 1440];
        for (const width of widths) for (const theme of ['light', 'dark']) {
            const page = await browser.newPage();
            page.on('pageerror', error => console.error('UI error:', error instanceof Error ? error.message : String(error)));
            results.push(await check(page, origin, width, theme));
            await page.close();
        }
        fs.writeFileSync(path.join(output, widthsArgument ? `results-${widths.join('-')}.json` : 'results.json'), JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results, null, 2));
    } finally { scenario?.partial.release(); scenario?.retry.release(); scenario?.finish.release(); clearTestProviderOverride(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
