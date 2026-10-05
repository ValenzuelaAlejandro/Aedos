const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { comparePngBuffers } = require('./visual-baseline-utils');
const browserSnippets = require('./visual/browser-snippets');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'visual-baseline-test-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';
require('dotenv').config = () => ({ parsed: {} });

const root = path.resolve(__dirname, '..');
const compare = process.argv.includes('--compare');
const onlyScenarioArg = process.argv.find((arg) => arg.startsWith('--scenario='));
const outputDir = compare
    ? path.join(root, 'tmp', 'baseline-current')
    : path.join(root, 'tests', 'baseline', 'screenshots');
const diffDir = path.join(root, 'tmp', 'baseline-diffs');
const visualConfig = JSON.parse(
    fs.readFileSync(path.join(root, 'tests', 'baseline', 'visual-config.json'), 'utf8'),
);
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

const scenarios = {
    'desktop-light.png': { width: 1440, height: 900, theme: 'light', state: 'landing' },
    'desktop-dark.png': { width: 1440, height: 900, theme: 'dark', state: 'landing' },
    'mobile-light.png': { width: 390, height: 844, theme: 'light', state: 'landing' },
    'modal-error-mobile.png': { width: 390, height: 844, theme: 'light', state: 'modal' },
    'outline-editable-desktop.png': {
        width: 1440,
        height: 900,
        theme: 'dark',
        state: 'outline',
    },
    'presentation-iframe-desktop.png': {
        width: 1440,
        height: 900,
        theme: 'dark',
        state: 'preview',
    },
};

async function startRuntime() {
    const { app } = require('../src/backend/server');
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: true, executablePath: chromePath });
    return {
        browser,
        origin,
        async close() {
            await browser.close();
            server.closeAllConnections?.();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

async function createScenarioPage(browser, origin, scenario) {
    const page = await browser.newPage();
    await page.setViewport({
        width: scenario.width,
        height: scenario.height,
        deviceScaleFactor: 1,
    });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin === origin) {
            if (url.pathname === '/__dev__/last-generated' && request.method() === 'HEAD') {
                request.respond({ status: 404, body: '' });
            } else request.continue();
        } else request.abort();
    });
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({
        content:
            `*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}${scenario.state === 'landing' ? '.hero-cursor{visibility:hidden!important}' : ''}`,
    });
    await page.evaluate(browserSnippets.applyTheme, scenario.theme);
    await page.evaluate(browserSnippets.waitForFrames);

    if (scenario.state === 'modal') {
        await page.evaluate(browserSnippets.showErrorModal);
    } else if (scenario.state === 'outline') await prepareOutline(page);
    else if (scenario.state === 'preview') await preparePreview(page);
    await page.evaluate(browserSnippets.waitForFrames);
    return page;
}

async function prepareOutline(page) {
    await page.evaluate(browserSnippets.renderOutline);
    await page.waitForFunction(browserSnippets.outlineIsVisible);
}

async function preparePreview(page) {
    await page.evaluate(browserSnippets.renderPreview);
    await page.waitForFunction(browserSnippets.previewIsVisible);
}

async function captureScenario(browser, origin, name) {
    const scenario = scenarios[name];
    if (!scenario) throw new Error(`Unknown visual scenario: ${name}`);
    const page = await createScenarioPage(browser, origin, scenario);
    try {
        return await page.screenshot({ type: 'png', fullPage: false });
    } finally {
        await page.close();
    }
}

async function run() {
    const selectedNames = onlyScenarioArg
        ? [onlyScenarioArg.slice('--scenario='.length)]
        : Object.keys(scenarios);
    fs.mkdirSync(outputDir, { recursive: true });
    const runtime = await startRuntime();
    const results = [];
    try {
        for (const name of selectedNames) {
            const actualBuffer = await captureScenario(runtime.browser, runtime.origin, name);
            const actualPath = path.join(outputDir, name);
            fs.writeFileSync(actualPath, actualBuffer);
            if (compare) {
                const expectedPath = path.join(root, 'tests', 'baseline', 'screenshots', name);
                const result = comparePngBuffers(
                    fs.readFileSync(expectedPath),
                    actualBuffer,
                    visualConfig.comparison,
                );
                results.push({ name, ...result });
                console.log(
                    `${name}: ${result.differentPixels} pixels (${(result.ratio * 100).toFixed(4)}%), max region RGB distance ${result.maxRegionDistance.toFixed(1)} at tile ${result.maxRegion.x},${result.maxRegion.y}`,
                );
                if (!result.passed) {
                    fs.mkdirSync(diffDir, { recursive: true });
                    fs.writeFileSync(path.join(diffDir, name), result.diffBuffer);
                    throw new Error(`Visual baseline differs: ${name}`);
                }
            }
        }
    } finally {
        await runtime.close();
    }
    if (compare)
        console.log(
            `Visual baseline OK: ${results.length} screenshots passed pixel and region checks.`,
        );
    else console.log(`Baseline screenshots written to ${path.relative(root, outputDir)}`);
}

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error.stack || error);
            process.exit(1);
        });
}

module.exports = {
    root,
    scenarios,
    visualConfig,
    startRuntime,
    createScenarioPage,
    captureScenario,
    comparePngBuffers,
};
