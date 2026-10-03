/// <reference path="./browser-globals.d.ts" />
/* global document, MutationObserver, window */
const path = require('node:path');
const fs = require('node:fs');

/** @typedef {{ status: number, type: string, body: string }} MockResponsePlan */
/** @typedef {Record<string, Array<[string, string]>>} SourceMutations */

const root = path.resolve(__dirname, '../..');
const skeleton = {
    topic: 'Energía solar para ciudades resilientes',
    subtitle_context: 'Una propuesta clara para una audiencia general.',
    tone: 'academic',
    audience: 'general',
    density: 'medium',
    language: 'es',
    suggested_chips: ['Añade un ejemplo local', 'Compara dos alternativas'],
    slides: [
        {
            title: 'La energía que llega del sol',
            role: 'opening',
            key_points: ['Radiación solar disponible', 'Conversión fotovoltaica'],
        },
        {
            title: 'De panel a red eléctrica',
            role: 'process',
            key_points: ['Generación distribuida', 'Almacenamiento y balance'],
        },
        {
            title: 'Ciudades con energía limpia',
            role: 'conclusion',
            key_points: ['Beneficios locales', 'Próximos pasos'],
        },
    ],
};

const presentation = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:Arial,sans-serif}
body{display:flex;overflow:hidden;background:#101826}section.s{position:relative;flex:0 0 100vw;width:100vw;height:100vh;padding:90px;background:#f8fafc;color:#14213d}
h1{font-size:48px;margin:0 0 24px}p{font-size:24px}.layer-back{position:absolute;left:70px;top:70px;width:140px;height:100px;background:#dbeafe;z-index:1}
.layer-front{position:absolute;left:90px;top:90px;width:140px;height:100px;background:#fca5a5;z-index:2}
</style></head><body><section class="s active"><h1>La energía que llega del sol</h1><p>Radiación solar disponible para todas las ciudades.</p><div class="layer-back"></div><div class="layer-front"></div></section><section class="s"><h1>De panel a red eléctrica</h1><p>Almacenamiento y balance.</p><div class="layer-back"></div><div class="layer-front"></div></section></body></html>`;

function sse(events) {
    return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

function defaultPlan(pathname) {
    if (pathname === '/generate-skeleton') {
        return {
            status: 200,
            type: 'text/event-stream',
            body: sse([{ chunk: JSON.stringify(skeleton) }, { done: true, skeleton }]),
        };
    }
    if (pathname === '/generate') {
        return {
            status: 200,
            type: 'text/event-stream',
            body: sse([{ chunk: presentation }, { done: true, html: presentation }]),
        };
    }
    if (pathname === '/generate-outline-item') {
        return { status: 200, type: 'application/json', body: JSON.stringify({ title: 'Ejemplo local' }) };
    }
    if (pathname === '/finalize') {
        return {
            status: 200,
            type: 'application/json',
            body: JSON.stringify({ pdfUrl: 'data:application/pdf;base64,JVBERi0xLjQK' }),
        };
    }
    if (pathname === '/finalize-pptx') {
        return {
            status: 200,
            type: 'application/json',
            body: JSON.stringify({ pptxUrl: 'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEsDBA==' }),
        };
    }
    return null;
}

function applySourceMutation(urlOrPath, body, mutations) {
    const pathname = typeof urlOrPath === 'string' ? urlOrPath : urlOrPath.pathname;
    body = body.replace(/\r\n/g, '\n');
    const mutation = mutations[pathname];
    if (!mutation) return body;
    for (const [before, after] of mutation) {
        if (!body.includes(before)) throw new Error(`Mutation anchor not found in ${pathname}: ${before}`);
        body = body.replace(before, after);
    }
    return body;
}

function installMotionOverrides(page) {
    return page.evaluateOnNewDocument(() => {
        Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true });
        const installMotionOverride = () => {
            const documentRoot = document.documentElement;
            if (!documentRoot || documentRoot.querySelector('#editor-safety-motion-override')) return;
            const style = document.createElement('style');
            style.id = 'editor-safety-motion-override';
            style.textContent = `
                html:root:root:root *, html:root:root:root *::before, html:root:root:root *::after {
                    animation-delay: 0s !important;
                    animation-duration: 0s !important;
                    animation-iteration-count: 1 !important;
                    transition-delay: 0s !important;
                    transition-duration: 0s !important;
                    scroll-behavior: auto !important;
                    caret-color: transparent !important;
                }
            `;
            (document.head || documentRoot).appendChild(style);
        };
        new MutationObserver(installMotionOverride).observe(document, { childList: true, subtree: true });
        document.addEventListener('DOMContentLoaded', installMotionOverride, { once: true });
        installMotionOverride();
        const complete = (vars) => { if (typeof vars?.onComplete === 'function') vars.onComplete(); };
        window.gsap = {
            to(_target, vars) { complete(vars); return { kill() {} }; },
            fromTo(_target, _from, vars) { complete(vars); return { kill() {} }; },
            set() {},
            killTweensOf() {},
        };
    });
}

async function installRequestRouting(page, { repoRoot, origin, trace, getPlans, mutations }) {
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
        const url = new URL(request.url());
        try {
            if (url.origin !== origin) {
                await request.abort();
                return;
            }
            if (url.pathname === '/__dev__/last-generated' && request.method() === 'HEAD') {
                await request.respond({ status: 404, body: '' });
                return;
            }
            if (['/generate-skeleton', '/generate', '/generate-outline-item', '/finalize', '/finalize-pptx'].includes(url.pathname) && request.method() === 'POST') {
                const plans = getPlans();
                const planned = plans.length ? plans.shift() : null;
                const response = planned || defaultPlan(url.pathname);
                const events = response.type === 'text/event-stream'
                    ? response.body.split(/\r?\n/).filter((line) => line.startsWith('data: ')).map((line) => {
                        try { return Object.keys(JSON.parse(line.slice(6)))[0]; } catch { return 'invalid'; }
                    })
                    : undefined;
                const postData = request.postData() || '';
                trace.push({ path: url.pathname, method: request.method(), status: response.status, events, languageJa: postData.includes('ja') });
                await request.respond({
                    status: response.status,
                    contentType: response.type,
                    headers: { 'access-control-allow-origin': '*' },
                    body: response.body,
                });
                return;
            }
            if (url.pathname.endsWith('.js')) {
                const sourcePath = path.join(repoRoot, 'src/frontend', url.pathname.replace(/^\/+/, ''));
                await request.respond({
                    status: 200,
                    contentType: 'application/javascript',
                    body: applySourceMutation(url, fs.readFileSync(sourcePath, 'utf8'), mutations),
                });
                return;
            }
            await request.continue();
        } catch (error) {
            console.error(`Browser request interception failed for ${url.pathname}: ${error.message}`);
            if (!request.isInterceptResolutionHandled()) await request.abort().catch(() => {});
        }
    });
}

async function createPage({ repoRoot, browser, origin, trace, getPlans, mutations }) {
    for (const [urlPath, edits] of Object.entries(mutations)) {
        const sourcePath = path.join(repoRoot, 'src/frontend', urlPath.replace(/^\/+/, ''));
        applySourceMutation(urlPath, fs.readFileSync(sourcePath, 'utf8'), { [urlPath]: edits });
    }
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await installMotionOverrides(page);
    await installRequestRouting(page, { repoRoot, origin, trace, getPlans, mutations });
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({
        content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important} html{scroll-behavior:auto!important}',
    });
    await page.evaluate(() => document.fonts?.ready);
    return page;
}

async function startRuntime() {
    process.env.NODE_ENV = 'test';
    process.env.GEMINI_API_KEY = 'editor-safety-browser-stub';
    process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
    require('dotenv').config = () => ({ parsed: {} });

    const puppeteer = require('puppeteer');
    const { app } = require('../../src/backend/server');
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
    const chromePath =
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        path.join(
            root,
            'puppeteer-cache',
            'chrome-headless-shell',
            'win64-146.0.7680.76',
            'chrome-headless-shell-win64',
            'chrome-headless-shell.exe',
        );
    const browser = await puppeteer.launch({ headless: true, executablePath: chromePath });
    const trace = [];
    let plans = [];

    return {
        root,
        browser,
        origin,
        trace,
        setPlans(nextPlans) {
            plans = [...nextPlans];
        },
        newPage(mutations = {}) {
            return createPage({ repoRoot: root, browser, origin, trace, getPlans: () => plans, mutations });
        },
        async close() {
            await browser.close();
            server.closeAllConnections?.();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

module.exports = { root, skeleton, presentation, sse, startRuntime };
