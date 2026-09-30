const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;
const { PNG } = require('pngjs');
const puppeteer = require('puppeteer');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'baseline-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';

const root = path.resolve(__dirname, '..');
const compare = process.argv.includes('--compare');
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
            if (url.startsWith(`http://127.0.0.1:${port}`) || url.startsWith('http://localhost:'))
                request.continue();
            else request.abort();
        });
        await page
            .addStyleTag({ content: '*{animation:none!important;transition:none!important;}' })
            .catch(() => {});
        await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
        await page.addStyleTag({
            content: '*{animation:none!important;transition:none!important;}',
        });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await new Promise((resolve) => setTimeout(resolve, 250));
        await page.screenshot({ path: path.join(outputDir, 'desktop-light.png'), fullPage: true });

        await page.evaluate(() => document.body.classList.toggle('dark-mode'));
        await page.screenshot({ path: path.join(outputDir, 'desktop-dark.png'), fullPage: true });

        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.screenshot({ path: path.join(outputDir, 'mobile-light.png'), fullPage: true });

        await page.evaluate(() => {
            const modal = document.querySelector('#error-container');
            if (modal) modal.classList.remove('hidden');
        });
        await page.screenshot({
            path: path.join(outputDir, 'modal-error-mobile.png'),
            fullPage: true,
        });
        const expectedDir = path.join(root, 'tests', 'baseline', 'screenshots');
        const names = [
            'desktop-light.png',
            'desktop-dark.png',
            'mobile-light.png',
            'modal-error-mobile.png',
        ];
        if (compare) {
            for (const name of names) {
                const expectedBuffer = fs.readFileSync(path.join(expectedDir, name));
                const actualBuffer = fs.readFileSync(path.join(outputDir, name));
                const expected = PNG.sync.read(expectedBuffer);
                const actual = PNG.sync.read(actualBuffer);
                if (expected.width !== actual.width || expected.height !== actual.height)
                    throw new Error(`Visual dimensions differ: ${name}`);
                const masks = visualConfig[name] || [];
                for (const mask of masks) {
                    for (let y = mask.y; y < Math.min(actual.height, mask.y + mask.height); y++) {
                        for (let x = mask.x; x < Math.min(actual.width, mask.x + mask.width); x++) {
                            const offset = (y * actual.width + x) * 4;
                            actual.data[offset] = expected.data[offset];
                            actual.data[offset + 1] = expected.data[offset + 1];
                            actual.data[offset + 2] = expected.data[offset + 2];
                            actual.data[offset + 3] = expected.data[offset + 3];
                        }
                    }
                }
                const diff = new PNG({ width: expected.width, height: expected.height });
                const differentPixels = pixelmatch(
                    expected.data,
                    actual.data,
                    diff.data,
                    expected.width,
                    expected.height,
                    { threshold: 0.1 },
                );
                const ratio = differentPixels / (expected.width * expected.height);
                if (ratio > 0.001) {
                    fs.mkdirSync(diffDir, { recursive: true });
                    fs.writeFileSync(path.join(diffDir, name), PNG.sync.write(diff));
                    throw new Error(
                        `Visual baseline differs: ${name} (${differentPixels} pixels, ${(ratio * 100).toFixed(3)}%)`,
                    );
                }
                const hash = crypto.createHash('sha256').update(expectedBuffer).digest('hex');
                if (hash !== crypto.createHash('sha256').update(actualBuffer).digest('hex'))
                    console.warn(
                        `Visual baseline passed pixel tolerance: ${name} (${differentPixels} pixels)`,
                    );
            }
            console.log(
                'Visual baseline OK: 4 screenshots passed pixel diff (threshold=0.1, max ratio=0.1%).',
            );
        } else {
            console.log(`Baseline screenshots written to ${path.relative(root, outputDir)}`);
        }
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

capture()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
