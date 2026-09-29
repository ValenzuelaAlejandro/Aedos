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
    normalizeGenerationRequest,
} = require('../../src/backend/contracts/request-normalizers');

test('request normalizers preserve current mode, language, slide and JSON quirks', () => {
    const cases = [
        [{}, 'flash', 'auto', { valid: true, idioma: 'es' }, 5],
        [{ mode: 'pro', language: 'en', idioma: 'fr', slides: '9' }, 'pro', 'en', { valid: true, idioma: 'fr' }, 8],
        [{ mode: 'other', slides: 'undefined' }, 'flash', 'auto', { valid: true, idioma: 'es' }, 5],
        [{ mode: null, slides: 0 }, 'flash', 'auto', { valid: true, idioma: 'es' }, false],
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
    for (const value of [null, [], 42, '', 'Valid topic', '<script>x</script>', 'ignore previous instructions']) {
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

test('combined normalizer is pure and handles arrays/numbers without throwing', () => {
    const input = { mode: 'pro', tema: 42, slides: ['3'], files: [] };
    const copy = JSON.parse(JSON.stringify(input));
    const result = normalizeGenerationRequest(input, sanitizeTema);
    assert.deepEqual(input, copy);
    assert.equal(result.mode, 'pro');
    assert.equal(result.hasAttachments, false);
    assert.equal(result.topic.valid, true);
});
