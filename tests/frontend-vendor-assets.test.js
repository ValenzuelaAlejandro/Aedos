const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const frontendRoot = path.join(__dirname, '..', 'src/frontend');
const vendorAssetsPath = path.join(frontendRoot, 'features/shared/vendor-assets.js');
const vendorAssets = require(vendorAssetsPath);

test('browser vendor catalog writes the pinned assets in the original blocking order', () => {
    const source = fs.readFileSync(vendorAssetsPath, 'utf8');
    const writes = [];
    const document = { currentScript: {}, write: (markup) => writes.push(markup) };

    vm.runInNewContext(source, { document });

    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].split('\n'), [
        `<script src="${vendorAssets.lucide.url}" integrity="${vendorAssets.lucide.integrity}" crossorigin="anonymous"></script>`,
        `<script src="${vendorAssets.gsap.url}" integrity="${vendorAssets.gsap.integrity}" crossorigin="anonymous"></script>`,
        `<script src="${vendorAssets.motion.url}" integrity="${vendorAssets.motion.integrity}" crossorigin="anonymous"></script>`,
        `<link rel="stylesheet" href="${vendorAssets.mobileDragDropCss.url}" integrity="${vendorAssets.mobileDragDropCss.integrity}" crossorigin="anonymous" />`,
        `<script src="${vendorAssets.mobileDragDrop.url}" integrity="${vendorAssets.mobileDragDrop.integrity}" crossorigin="anonymous"></script>`,
        `<script src="${vendorAssets.mobileDragDropScroll.url}" integrity="${vendorAssets.mobileDragDropScroll.integrity}" crossorigin="anonymous"></script>`
    ]);
});

test('index loads the shared catalog before app globals and contains no duplicate CDN URLs', () => {
    const html = fs.readFileSync(path.join(frontendRoot, 'index.html'), 'utf8');
    const loader = '<script src="features/shared/vendor-assets.js?v=1"></script>';
    const loaderIndex = html.indexOf(loader);
    const i18nIndex = html.indexOf('<script src="features/shared/i18n.js?v=3"></script>');

    assert.notEqual(loaderIndex, -1);
    assert.ok(loaderIndex < i18nIndex, 'vendor globals are installed before feature scripts');
    assert.doesNotMatch(html, /https:\/\/(?:unpkg\.com|cdnjs\.cloudflare\.com)\//);
});

test('backend generated-slide Lucide uses the shared catalog version and integrity', () => {
    const routeSource = fs.readFileSync(path.join(__dirname, '../src/backend/http/routes/generate-output.js'), 'utf8');

    assert.match(routeSource, /vendorAssets\.lucide\.url/);
    assert.match(routeSource, /vendorAssets\.lucide\.integrity/);
    assert.equal(vendorAssets.lucide.url, 'https://unpkg.com/lucide@0.577.0/dist/umd/lucide.min.js');
});
