const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    root,
    scenarios,
    visualConfig,
    startRuntime,
    createScenarioPage,
    comparePngBuffers,
} = require('./capture-baseline');
const browserSnippets = require('./visual/browser-snippets');

const cases = [
    {
        name: '1a chat-screen fondo rojo',
        selector: '#chat-screen',
        mutation: { property: 'background-color', value: 'rgb(255, 0, 0)' },
        shouldFail: true,
    },
    {
        name: '1b body fondo rojo (cubierto; esperado: no falla)',
        selector: 'body',
        mutation: { property: 'background-color', value: 'rgb(255, 0, 0)' },
        shouldFail: false,
        bodyOverlay: '#chat-screen',
    },
    {
        name: '2 mover botón 20px',
        selector: '#theme-toggle-btn',
        mutation: { property: 'transform', value: 'translateX(20px)' },
        shouldFail: true,
    },
    {
        name: '3 cambiar color de texto',
        selector: '.hero-title',
        mutation: { property: 'color', value: 'rgb(255, 0, 0)' },
        shouldFail: true,
    },
    {
        name: '4 cambiar border-radius',
        selector: '.chat-input-wrapper',
        mutation: { property: 'border-radius', value: '0px' },
        shouldFail: true,
    },
    {
        name: '5 ocultar icono',
        selector: '#theme-toggle-btn .icon-sun',
        mutation: { property: 'visibility', value: 'hidden' },
        shouldFail: true,
    },
    {
        name: '6 título +2px',
        selector: '.hero-title',
        mutation: { property: 'font-size', incrementPx: 2 },
        shouldFail: true,
    },
    {
        name: 'control comentario CSS',
        selector: '.hero-title',
        commentOnly: true,
        shouldFail: false,
    },
];

async function applyMutation(page, mutation) {
    if (mutation.commentOnly) {
        await page.addStyleTag({ content: '/* intentional no-op visual control */' });
        return;
    }
        await page.evaluate(browserSnippets.applyStyleMutation, mutation);
}

async function runCase(runtime, testCase, expectedBuffer, outputDir) {
    const page = await createScenarioPage(
        runtime.browser,
        runtime.origin,
        scenarios['desktop-light.png'],
    );
    try {
        const before = await page.evaluate(browserSnippets.inspectVisibleTarget, {
            selector: testCase.selector,
            overlaySelector: testCase.bodyOverlay,
        });
        assert.ok(before.rendered, `Target is not visible before mutation: ${testCase.name}`);
        if (testCase.bodyOverlay)
            assert.ok(before.covered, `Expected covering layer missing: ${testCase.name}`);
        await applyMutation(page, {
            selector: testCase.selector,
            ...testCase.mutation,
            commentOnly: testCase.commentOnly,
        });
        const actualBuffer = await page.screenshot({ type: 'png', fullPage: false });
        const comparison = comparePngBuffers(expectedBuffer, actualBuffer, visualConfig.comparison);
        const index = cases.indexOf(testCase) + 1;
        fs.writeFileSync(path.join(outputDir, `${index}.png`), comparison.diffBuffer);
        const detected = !comparison.passed;
        assert.equal(
            detected,
            testCase.shouldFail,
            `${testCase.name}: expected ${testCase.shouldFail ? 'detection' : 'pass'}, got ${detected ? 'detection' : 'pass'}`,
        );
        return {
            name: testCase.name,
            pixels: comparison.differentPixels,
            ratioPercent: Number((comparison.ratio * 100).toFixed(5)),
            maxRegionDistance: Number(comparison.maxRegionDistance.toFixed(1)),
            targetStyle: before.computed,
            targetRect: before.rect,
            covered: before.covered,
            result: detected ? 'FALLA detectada' : 'PASA',
        };
    } finally {
        await page.close();
    }
}

async function run() {
    const runtime = await startRuntime();
    const expectedBuffer = fs.readFileSync(
        path.join(root, 'tests', 'baseline', 'screenshots', 'desktop-light.png'),
    );
    const outputDir = path.join(root, 'tmp', 'baseline-mutations');
    fs.mkdirSync(outputDir, { recursive: true });
    const output = [];

    try {
        for (const testCase of cases) {
            const result = await runCase(runtime, testCase, expectedBuffer, outputDir);
            output.push(result);
            console.log(JSON.stringify(result));
        }
    } finally {
        await runtime.close();
    }
    console.log(`Visual mutation checks OK: ${output.length} cases.`);
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error.stack || error);
        process.exit(1);
    });
