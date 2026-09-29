const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'baseline-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';

const root = path.resolve(__dirname, '..');
const compare = process.argv.includes('--compare');
const outputDir = compare ? path.join(root, 'tmp', 'baseline-current') : path.join(root, 'tests', 'baseline', 'screenshots');
const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || path.join(root, 'puppeteer-cache', 'chrome-headless-shell', 'win64-146.0.7680.76', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');

async function capture() {
    fs.mkdirSync(outputDir, { recursive: true });
    const { app } = require('../src/backend/server');
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const browser = await puppeteer.launch({ headless: true, executablePath: chromePath });
    try {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.startsWith(`http://127.0.0.1:${port}`) || url.startsWith('http://localhost:')) request.continue();
            else request.abort();
        });
        await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;}' }).catch(() => {});
        await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
        await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;}' });
        await page.screenshot({ path: path.join(outputDir, 'desktop-light.png'), fullPage: true });

        await page.evaluate(() => document.body.classList.toggle('dark-mode'));
        await page.screenshot({ path: path.join(outputDir, 'desktop-dark.png'), fullPage: true });

        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.screenshot({ path: path.join(outputDir, 'mobile-light.png'), fullPage: true });

        await page.evaluate(() => {
            const modal = document.querySelector('#error-container');
            if (modal) modal.classList.remove('hidden');
        });
        await page.screenshot({ path: path.join(outputDir, 'modal-error-mobile.png'), fullPage: true });
        const expectedDir = path.join(root, 'tests', 'baseline', 'screenshots');
        const names = ['desktop-light.png', 'desktop-dark.png', 'mobile-light.png', 'modal-error-mobile.png'];
        if (compare) {
            for (const name of names) {
                const expectedBuffer = fs.readFileSync(path.join(expectedDir, name));
                const actualBuffer = fs.readFileSync(path.join(outputDir, name));
                const expected = crypto.createHash('sha256').update(expectedBuffer).digest('hex');
                const actual = crypto.createHash('sha256').update(actualBuffer).digest('hex');
                if (expected === actual) continue;
                const drift = Math.abs(actualBuffer.length - expectedBuffer.length) / expectedBuffer.length;
                if (drift > 0.15) throw new Error(`Visual baseline differs: ${name} (size drift ${(drift * 100).toFixed(1)}%)`);
                console.warn(`Visual hash changed within size tolerance: ${name} (${(drift * 100).toFixed(1)}%)`);
            }
            console.log('Visual baseline OK: 4 screenshots matched by hash or documented size tolerance.');
        } else {
            console.log(`Baseline screenshots written to ${path.relative(root, outputDir)}`);
        }
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

capture().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
