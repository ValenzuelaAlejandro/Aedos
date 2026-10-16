/* global window, document, getComputedStyle */
const assert = require('node:assert/strict');
const { checkLoadingStates, luminance } = require('./visual/streaming-orb-check');
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
const output = path.resolve(process.env.AEDOS_UI_EVIDENCE_DIR || 'test-evidence/block4');
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
async function dragSettingsHandle(page) {
    const bounds = await page.$eval('#mobile-settings-handle', node => {
        const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(bounds.x, bounds.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x, bounds.y + 35, { steps: 3 });
    await page.mouse.up();
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

// eslint-disable-next-line max-lines-per-function, complexity -- Validate the full browser retry and responsive lifecycle in one isolated scenario.
async function check(page, origin, width, theme) {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewport({ width, height: 900, deviceScaleFactor: width <= 480 ? 2 : 1 });
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
    if (width <= 480) {
        assert.notEqual(await page.$eval('#credits-balance-label', node => getComputedStyle(node).display), 'none');
        assert.match(await page.$eval('#credits-balance-label', node => node.textContent), /restante|remaining/i);
        assert.match(await page.$eval('#credits-balance-trigger', node => node.title), /Quedan|remains/);
    }
    if (width <= 430) {
        assert.ok(header.discordHidden);
        for (const control of header.topControls.filter(item => item.width > 0)) {
            assert.ok(control.left >= header.topPanelLeft - 1 && control.right <= header.topPanelRight + 1,
                JSON.stringify({ width, header, control }));
        }
    }
    const compactLayout = await page.$eval('html', node => node.classList.contains('compact-chat-controls'));
    if (compactLayout) {
        const controls = await page.evaluate(() => [...document.querySelectorAll(
            '#btn-attach-file, #generation-mode-toggle, #btn-model-dropdown, #mobile-settings-trigger, #btn-generate'
        )].map(node => { const rect = node.getBoundingClientRect(); return { id: node.id, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; }));
        assert.equal(controls.length, 5);
        assert.ok(controls.every(control => control.width >= 40 && control.height >= 39.5), JSON.stringify({ width, controls }));
        assert.ok(controls.every((control, index) => index === 0 || controls[index - 1].right <= control.x + 1), JSON.stringify({ width, controls }));
        assert.ok(controls.slice(1, 4).every((control, index) => control.x - controls[index].right <= 12), JSON.stringify({ width, controls }));
        assert.equal(await page.$eval('#credits-cost-preview', node => getComputedStyle(node).display), 'none');
        assert.equal(await page.$eval('#current-model-label', node => getComputedStyle(node).display), 'none');
        assert.match(await page.$eval('#btn-model-dropdown', node => node.getAttribute('aria-label')), /Gemini|model/i);
        await page.click('#mobile-settings-trigger');
        await new Promise(resolve => setTimeout(resolve, 220));
        assert.equal(await page.$eval('#mobile-settings-panel', node => node.hidden), false);
        const settingsBounds = await page.$eval('#mobile-settings-panel', node => {
            const bounds = node.getBoundingClientRect(), track = node.querySelector('.slide-count-range-track').getBoundingClientRect();
            const trigger = document.getElementById('mobile-settings-trigger').getBoundingClientRect();
            const badge = document.getElementById('mobile-settings-slide-badge').getBoundingClientRect();
            const overlayHit = point => document.elementFromPoint(point.x, point.y)?.id;
            const textarea = document.getElementById('w-tema').getBoundingClientRect();
            return { panel: { left: bounds.left, right: bounds.right, width: bounds.width, top: bounds.top, bottom: bounds.bottom,
                    height: bounds.height, scrollHeight: node.scrollHeight }, track: { left: track.left, right: track.right },
                badge: { left: badge.left, right: badge.right, top: badge.top, bottom: badge.bottom },
                trigger: { left: trigger.left, right: trigger.right, top: trigger.top, bottom: trigger.bottom },
                triggerHit: overlayHit({ x: trigger.left + trigger.width / 2, y: trigger.top + trigger.height / 2 }),
                chatboxHit: overlayHit({ x: textarea.left + textarea.width / 2, y: textarea.top + textarea.height / 2 }),
                headerHit: overlayHit({ x: 10, y: 10 }), viewport: window.innerWidth,
                children: [...node.children].map(child => ({ id: child.id, className: child.className, top: child.getBoundingClientRect().top,
                    bottom: child.getBoundingClientRect().bottom, height: child.getBoundingClientRect().height, display: getComputedStyle(child).display })) };
        });
        assert.ok(settingsBounds.panel.left === 0 && settingsBounds.panel.right === settingsBounds.viewport, JSON.stringify(settingsBounds));
        assert.ok(settingsBounds.panel.bottom >= 899 && settingsBounds.panel.height <= 630, JSON.stringify(settingsBounds));
        assert.ok(settingsBounds.panel.scrollHeight <= settingsBounds.panel.height + 1, JSON.stringify(settingsBounds));
        assert.ok(settingsBounds.track.left >= settingsBounds.panel.left && settingsBounds.track.right <= settingsBounds.panel.right, JSON.stringify(settingsBounds));
        assert.ok(settingsBounds.badge.left >= settingsBounds.trigger.left && settingsBounds.badge.right <= settingsBounds.trigger.right
            && settingsBounds.badge.top >= settingsBounds.trigger.top && settingsBounds.badge.bottom <= settingsBounds.trigger.bottom, JSON.stringify(settingsBounds));
        assert.equal(settingsBounds.triggerHit, 'mobile-settings-backdrop', JSON.stringify(settingsBounds));
        assert.equal(settingsBounds.chatboxHit, 'mobile-settings-backdrop', JSON.stringify(settingsBounds));
        assert.equal(settingsBounds.headerHit, 'mobile-settings-backdrop', JSON.stringify(settingsBounds));
        assert.equal(await page.$eval('#mobile-settings-trigger', node => node.style.zIndex), '');
        assert.equal(await page.$eval('body', node => getComputedStyle(node).overflowY), 'hidden');
        assert.equal(await page.$eval('#mobile-settings-backdrop', node => node.hidden), false);
        assert.match(await page.$eval('#mobile-settings-usage-estimate', node => node.textContent), /\d+(?:\.\d+)?%/);
        assert.match(await page.$eval('#credits-balance-trigger', node => node.getAttribute('aria-label')), /Quedan|remains/);
        await capture(page, `settings-open-${width}-${theme}`);
        assert.equal(await page.$eval('#slide-count-select', node => /** @type {HTMLInputElement} */ (node).max), '8');
        await page.click('#mobile-settings-close');
        assert.equal(await page.$eval('#mobile-settings-panel', node => node.hidden), true);
        assert.equal(await page.$eval('body', node => node.classList.contains('mobile-settings-open')), false);
        await page.click('#generation-mode-toggle');
        await page.waitForFunction(() => /** @type {HTMLInputElement} */ (document.getElementById('slide-count-select')).max === '15');
        await page.click('#generation-mode-toggle');
        await page.waitForFunction(() => /** @type {HTMLInputElement} */ (document.getElementById('slide-count-select')).max === '8');
        await page.click('#mobile-settings-trigger');
        await page.click('#btn-lang-dropdown');
        const languageScroll = await page.$eval('#lang-dropdown-menu', menu => {
            const sheet = document.getElementById('mobile-settings-panel');
            const style = getComputedStyle(menu);
            sheet.scrollTop = sheet.scrollHeight;
            return { sheetTop: sheet.scrollTop, sheetHeight: sheet.scrollHeight, sheetClient: sheet.clientHeight,
                menuTop: menu.scrollTop, menuHeight: menu.scrollHeight, menuClient: menu.clientHeight,
                position: style.position, maxHeight: style.maxHeight, overflowY: style.overflowY,
                labelWhiteSpace: getComputedStyle(document.querySelector('.chat-settings-language-row .mobile-settings-row-label')).whiteSpace };
        });
        assert.ok(languageScroll.sheetTop > 0 && languageScroll.sheetHeight > languageScroll.sheetClient, JSON.stringify(languageScroll));
        assert.equal(languageScroll.menuTop, 0);
        assert.equal(languageScroll.menuHeight, languageScroll.menuClient);
        assert.equal(languageScroll.position, 'static');
        assert.equal(languageScroll.maxHeight, 'none');
        assert.equal(languageScroll.overflowY, 'visible');
        assert.equal(languageScroll.labelWhiteSpace, 'nowrap');
        assert.equal(await page.$eval('#mobile-settings-panel', node => node.hidden), false);
        await page.click('#lang-dropdown-menu [data-lang="ar"]');
        assert.equal(await page.$eval('#mobile-settings-panel', node => node.hidden), false);
        assert.equal(await page.$eval('#lang-dropdown-menu', node => node.classList.contains('hidden')), true);
        assert.equal(await page.$eval('#btn-lang-dropdown', node => node.getAttribute('aria-expanded')), 'false');
        assert.equal(await page.$eval('#current-lang-label', node => node.textContent), 'العربية');
        assert.equal(await page.$eval('#current-lang-label', node => node.scrollWidth <= node.clientWidth), true);
        await page.mouse.click(2, 2);
        assert.equal(await page.$eval('#mobile-settings-panel', node => node.hidden), true);
        assert.equal(await page.$eval('body', node => node.classList.contains('mobile-settings-open')), false);
    }
    const proModelOrder = await page.evaluate(() => {
        const pro = document.getElementById('generation-mode-toggle').getBoundingClientRect();
        const model = document.getElementById('btn-model-dropdown').getBoundingClientRect();
        return { gap: model.left - pro.right, pro: { left: pro.left, right: pro.right }, model: { left: model.left, right: model.right } };
    });
    assert.ok(proModelOrder.gap >= 0 && proModelOrder.gap <= 24, JSON.stringify({ width, proModelOrder }));
    const toolbar = await page.evaluate(() => {
        const compact = document.documentElement.classList.contains('compact-chat-controls');
        const selectors = ['#btn-debug-last-generated', '#btn-attach-file', '#generation-mode-toggle', '#btn-model-dropdown', '#mobile-settings-trigger',
            '#btn-lang-dropdown', '#slide-count-trigger', '#credits-cost-preview', '#btn-generate'];
        const controls = selectors.map(selector => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { id: element.id, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
                shown: getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0 };
        }).filter(control => control?.shown).sort((a, b) => a.x - b.x);
        const bar = document.querySelector('.chat-actions').getBoundingClientRect();
        const rootWidth = document.querySelector('.chat-container').getBoundingClientRect().width;
        const threshold = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chat-toolbar-full-min-width'));
        const fullControlIds = ['.attach-button-wrap', '#generation-mode-toggle', '#btn-model-dropdown', '#btn-lang-dropdown',
            '#slide-count-trigger', '#credits-cost-preview', '#btn-generate'];
        const fullControlWidth = fullControlIds.reduce((sum, selector) => sum + document.querySelector(selector).getBoundingClientRect().width, 0);
        const wrapperStyle = getComputedStyle(document.querySelector('.chat-input-wrapper'));
        const horizontalPadding = parseFloat(wrapperStyle.paddingLeft) + parseFloat(wrapperStyle.paddingRight)
            + parseFloat(wrapperStyle.borderLeftWidth) + parseFloat(wrapperStyle.borderRightWidth);
        const leftGap = parseFloat(getComputedStyle(document.querySelector('.chat-actions-left')).gap);
        const rightGap = parseFloat(getComputedStyle(document.querySelector('.chat-actions-right')).gap);
        const betweenGroups = parseFloat(getComputedStyle(document.querySelector('.chat-actions')).gap);
        const measuredMinimum = fullControlWidth + 3 * leftGap + 2 * rightGap + betweenGroups + horizontalPadding;
        return { compact, containerWidth: rootWidth, threshold, measuredMinimum,
            controls, bar: { left: bar.left, right: bar.right } };
    });
    assert.equal(toolbar.compact, toolbar.containerWidth < toolbar.threshold, JSON.stringify({ width, toolbar }));
    if (!toolbar.compact) assert.ok(toolbar.threshold >= toolbar.measuredMinimum, JSON.stringify({ width, toolbar }));
    const expectedToolbarOrder = toolbar.compact
        ? ['btn-attach-file', 'generation-mode-toggle', 'btn-model-dropdown', 'mobile-settings-trigger', 'btn-generate']
        : ['btn-attach-file', 'generation-mode-toggle', 'btn-model-dropdown', 'btn-lang-dropdown', 'slide-count-trigger', 'credits-cost-preview', 'btn-generate'];
    if (toolbar.controls.some(control => control.id === 'btn-debug-last-generated')) expectedToolbarOrder.unshift('btn-debug-last-generated');
    assert.deepEqual(toolbar.controls.map(control => control.id), expectedToolbarOrder, JSON.stringify({ width, toolbar }));
    assert.ok(toolbar.controls.every((control, index) => index === 0 || toolbar.controls[index - 1].right <= control.x + 1), JSON.stringify({ width, toolbar }));
    assert.ok(toolbar.controls.every(control => control.x >= toolbar.bar.left - 1 && control.right <= toolbar.bar.right + 1), JSON.stringify({ width, toolbar }));
    assert.ok(Math.max(...toolbar.controls.map(control => control.y)) - Math.min(...toolbar.controls.map(control => control.y)) <= 12,
        JSON.stringify({ width, toolbar }));
    assert.ok(await page.$eval('#credits-cost-preview', node => node.textContent.includes('~')
        && /Uso estimado|Estimated use/.test(node.textContent) && !/Esta presentación usará|This presentation will use/.test(node.textContent)));
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
    assert.equal(await page.$eval('#btn-model-dropdown', node => node.disabled), true);
    assert.equal(await page.$eval('#generation-mode-toggle', node => node.disabled), true);
    const activeToolbar = await page.evaluate(() => {
        const containerWidth = document.querySelector('.chat-container').getBoundingClientRect().width;
        const threshold = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chat-toolbar-full-min-width'));
        const ids = ['#btn-debug-last-generated', '#btn-attach-file', '#generation-mode-toggle', '#btn-model-dropdown', '#mobile-settings-trigger',
            '#btn-lang-dropdown', '#slide-count-trigger', '#credits-cost-preview', '#btn-generate'];
        const controls = ids.map(selector => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { id: element.id, left: rect.left, right: rect.right, top: rect.top, width: rect.width,
                shown: getComputedStyle(element).display !== 'none' && rect.width > 0 };
        }).filter(control => control?.shown).sort((a, b) => a.left - b.left);
        const bar = document.querySelector('.chat-actions').getBoundingClientRect();
        return { compact: document.documentElement.classList.contains('compact-chat-controls'), containerWidth, threshold,
            controls, bar: { left: bar.left, right: bar.right } };
    });
    assert.equal(activeToolbar.compact, activeToolbar.containerWidth < activeToolbar.threshold, JSON.stringify({ width, activeToolbar }));
    const expectedActiveOrder = activeToolbar.compact
        ? ['btn-attach-file', 'generation-mode-toggle', 'btn-model-dropdown', 'mobile-settings-trigger', 'btn-generate']
        : ['btn-attach-file', 'generation-mode-toggle', 'btn-model-dropdown', 'btn-lang-dropdown', 'btn-generate'];
    if (activeToolbar.controls.some(control => control.id === 'btn-debug-last-generated')) expectedActiveOrder.unshift('btn-debug-last-generated');
    assert.deepEqual(activeToolbar.controls.map(control => control.id), expectedActiveOrder, JSON.stringify({ width, activeToolbar }));
    assert.ok(activeToolbar.controls.every((control, index) => index === 0 || activeToolbar.controls[index - 1].right <= control.left + 1), JSON.stringify({ width, activeToolbar }));
    assert.ok(activeToolbar.controls.every(control => control.left >= activeToolbar.bar.left - 1 && control.right <= activeToolbar.bar.right + 1), JSON.stringify({ width, activeToolbar }));
    assert.ok(Math.max(...activeToolbar.controls.map(control => control.top)) - Math.min(...activeToolbar.controls.map(control => control.top)) <= 12,
        JSON.stringify({ width, activeToolbar }));
    if (activeToolbar.compact) {
        await page.click('#mobile-settings-trigger');
        assert.equal(await page.$eval('#btn-lang-dropdown', node => node.disabled), false);
        await page.click('#btn-lang-dropdown');
        await page.$eval('#mobile-settings-panel', sheet => { sheet.scrollTop = sheet.scrollHeight; });
        assert.equal(await page.$eval('#mobile-settings-panel', node => node.hidden), false);
        await page.click('#lang-dropdown-menu [data-lang="es"]');
        assert.equal(await page.$eval('#mobile-settings-panel', node => node.hidden), false);
        assert.equal(await page.$eval('#current-lang-label', node => node.scrollWidth <= node.clientWidth), true);
        await dragSettingsHandle(page);
        assert.equal(await page.$eval('#mobile-settings-panel', node => node.hidden), true);
    }
    scenario = gates();
    await page.evaluate(s => { window.__uiGeneration = window.startFinalGeneration(s); }, skeleton);
    await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.body?.textContent.includes('FAILED SLIDE'));
    scenario.partial.release();
    await page.waitForFunction(() => document.getElementById('preview-stream-status-text').textContent === 'Reintentando...');
    await page.waitForFunction(() => !document.querySelector('iframe').contentDocument?.body?.textContent.includes('FAILED SLIDE'));
    await page.waitForFunction(() => document.getElementById('chat-screen').classList.contains('hidden') && getComputedStyle(document.getElementById('preview-container')).opacity === '1');
    const orbFrame = await page.$eval('.preview-stream-orb canvas', canvas => canvas.toDataURL());
    await page.waitForFunction(previous => document.querySelector('.preview-stream-orb canvas').toDataURL() !== previous, {}, orbFrame);
    const orbSize = await page.$eval('.preview-stream-orb canvas', canvas => {
        const bounds = canvas.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, bitmapWidth: canvas.width, bitmapHeight: canvas.height };
    });
    assert.ok(orbSize.width > 0 && Math.abs(orbSize.width - orbSize.height) < 1, JSON.stringify(orbSize));
    assert.equal(orbSize.bitmapWidth, orbSize.bitmapHeight);
    await page.evaluate(value => { document.documentElement.dataset.theme = value === 'light' ? 'dark' : 'light'; }, theme);
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
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
    // A late layout allocation must restart the loop, not leave one static paint.
    await page.$eval('.preview-stream-orb-overlay', node => { node.style.display = 'none'; });
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.$eval('.preview-stream-orb-overlay', node => { node.style.display = ''; });
    const loadingStates = await checkLoadingStates(page, width, theme, output, capture);
    await capture(page, `presentation-retry-${width}-${theme}`);
    scenario.retry.release();
    await page.waitForFunction(() => document.getElementById('preview-stream-status-text').textContent !== 'Reintentando...');
    scenario.finish.release();
    await page.evaluate(() => window.__uiGeneration);
    await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.body?.textContent.includes('Presentación completa'));
    assert.ok(!await page.evaluate(() => document.querySelector('iframe').contentDocument.body.textContent.includes('FAILED')));
    await page.evaluate(() => window.navigateToHome());
    // The preview orb remains mounted after leaving generation. Root class
    // changes from menu dismissal must not be passed to its animation clock.
    for (let repeat = 0; repeat < 2; repeat += 1) {
        await page.click('#btn-model-dropdown');
        if (width <= 480) await page.click('#model-sheet-close');
        else await page.keyboard.press('Escape');
    }
    assert.deepEqual(pageErrors, [], 'Opening and closing the model selector must produce zero pageerror');
    if (!await page.$eval('html', node => node.classList.contains('compact-chat-controls'))) {
        // The existing settings sheet is also used by narrow desktop composers.
        await page.$eval('.chat-container', node => { node.style.width = '680px'; });
        await page.waitForFunction(() => document.documentElement.classList.contains('compact-chat-controls'));
    }
    for (let repeat = 0; repeat < 2; repeat += 1) {
        await page.click('#mobile-settings-trigger');
        await page.click('#mobile-settings-close');
    }
    assert.deepEqual(pageErrors, [], 'Opening and closing settings with the orb mounted must produce zero pageerror');
    return { width, theme, header, toolbar, activeCompact: activeToolbar.compact, chatControls, geometry, contrast,
        liveChat: true, discardedChatDraft: true, discardedSlides: true, retryTextRestored: true, loadingStates };
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
