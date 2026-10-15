const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTema } = require('../../src/backend/server');
const {
    normalizeMode,
    normalizeRequestedLanguage,
    normalizeValidatedLanguage,
    normalizeSlides,
    normalizeSkeletonValue,
    normalizeTopic,
} = require('../../src/backend/contracts/request-normalizers');

test('request normalizers preserve current mode, language, slide and JSON quirks', () => {
    const cases = [
        [{}, 'flash', 'auto', { valid: true, idioma: 'auto' }, 5],
        [
            { mode: 'pro', language: 'en', idioma: 'fr', slides: '9' },
            'pro',
            'en',
            { valid: true, idioma: 'en' },
            9,
        ],
        [{ mode: 'other', slides: 'undefined' }, 'flash', 'auto', { valid: true, idioma: 'auto' }, 5],
        [{ mode: null, slides: 0 }, 'flash', 'auto', { valid: true, idioma: 'auto' }, false],
    ];
    for (const [body, mode, language, validated, slideValue] of cases) {
        assert.equal(normalizeMode(body), mode);
        assert.equal(normalizeRequestedLanguage(body), language);
        assert.deepEqual(normalizeValidatedLanguage(body), validated);
        const slides = normalizeSlides(body);
        if (slideValue === false) assert.equal(slides.valid, false);
        else assert.equal(slides.slides, slideValue);
    }
});

test('topic normalizer delegates to the real sanitizer and preserves truncation', () => {
    for (const value of [
        null,
        [],
        42,
        '',
        'Valid topic',
        '<script>x</script>',
        'ignore previous instructions',
    ]) {
        assert.deepEqual(normalizeTopic(value, sanitizeTema), sanitizeTema(String(value || '')));
    }
    const longTopic = 'x'.repeat(700);
    assert.equal(normalizeTopic(longTopic, sanitizeTema).tema.length, 600);
});

test('skeleton parsing preserves valid JSON and malformed-string behavior', () => {
    assert.deepEqual(normalizeSkeletonValue('{"slides":[]}'), { slides: [] });
    assert.equal(normalizeSkeletonValue('{bad'), '{bad');
    assert.equal(normalizeSkeletonValue(null), null);
});

test('slide counts are strict and mode-specific, including generationMode sent by the frontend', () => {
    assert.equal(normalizeMode({ mode: 'chat', generationMode: 'pro' }), 'pro');
    assert.equal(normalizeSlides({ mode: 'flash', slides: 8 }).valid, true);
    assert.equal(normalizeSlides({ mode: 'flash', slides: 9 }).valid, false);
    assert.equal(normalizeSlides({ mode: 'pro', slides: '15' }).slides, 15);
    assert.equal(normalizeSlides({ mode: 'pro', slides: 16 }).valid, false);
    for (const slides of [1.5, '1.5', '1e1', ['3'], null]) {
        assert.equal(normalizeSlides({ mode: 'pro', slides }).valid, false, String(slides));
    }
});
