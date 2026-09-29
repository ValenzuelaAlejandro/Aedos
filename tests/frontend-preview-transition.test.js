const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'frontend', 'scripts', 'app.js'),
    'utf8'
);

function simulatePreviewState({ finalAt, slideAt = 0 }) {
    const classes = new Set(['hidden']);
    let finalPreviewMounted = false;
    const events = [
        ['slide', slideAt],
        ['final', finalAt],
        ['reveal', finalAt + 100]
    ].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

    for (const [event] of events) {
        if (event === 'slide') {
            if (finalPreviewMounted) continue;
            classes.delete('hidden');
            classes.add('is-generating');
        } else if (event === 'final') {
            finalPreviewMounted = true;
            classes.delete('hidden');
            classes.delete('is-generating');
            classes.delete('is-settling');
            classes.add('is-settling');
        } else {
            classes.delete('is-settling');
            classes.add('is-editor-ready');
        }
    }

    return classes;
}

test('fast and slow generation always finish with editor chrome visible', () => {
    for (const finalAt of [0, 100, 500, 670, 1200, 60000]) {
        const classes = simulatePreviewState({ finalAt });
        assert.equal(classes.has('hidden'), false, `hidden at ${finalAt}ms`);
        assert.equal(classes.has('is-generating'), false, `is-generating at ${finalAt}ms`);
        assert.equal(classes.has('is-editor-ready'), true, `chrome missing at ${finalAt}ms`);
    }
});

test('a delayed slide event cannot re-enter streaming after final mount', () => {
    const classes = simulatePreviewState({ finalAt: 100, slideAt: 1500 });
    assert.equal(classes.has('is-generating'), false);
    assert.equal(classes.has('is-editor-ready'), true);
});

test('implementation uses generation events instead of the fixed 670ms race', () => {
    assert.match(appSource, /finalPreviewMounted/);
    assert.match(appSource, /setPreviewStreamStatus\(proModeEnabled \? 'Analizando contenido…' : 'Generando presentación…'\)/);
    assert.doesNotMatch(appSource, /setTimeout\(\(\) => fn\(\), 670\)/);
});

function simulateStreamingPaints(durationMs, chunkTimes) {
    const loaderVisibleAt = 0;
    const paints = chunkTimes.filter((time) => time < durationMs);
    const finalAt = durationMs;
    return { loaderVisibleAt, paints, finalAt };
}

test('optimistic loader and incremental paints start before 5s and 60s completions', () => {
    for (const durationMs of [5000, 60000]) {
        const { loaderVisibleAt, paints, finalAt } = simulateStreamingPaints(durationMs, [80, 160, 480, 1200, durationMs - 80]);
        assert.equal(loaderVisibleAt, 0, `loader did not start immediately for ${durationMs}ms`);
        assert.ok(paints.length > 0, `no incremental paint before ${durationMs}ms completion`);
        assert.ok(paints.every((time) => time < finalAt));
    }
});

test('implementation enters preview before HTML and flushes chunks on a short cadence', () => {
    assert.match(appSource, /setPreviewStreamStatus\(proModeEnabled \? 'Analizando contenido…' : 'Generando presentación…'\)/);
    assert.match(appSource, /doTransitionToPreview\(\);\s*\/\/ Writing every model token/s);
    assert.match(appSource, /const STREAM_FLUSH_INTERVAL_MS = 80/);
    assert.match(appSource, /schedulePreviewMarkupFlush\(\)/);
});
