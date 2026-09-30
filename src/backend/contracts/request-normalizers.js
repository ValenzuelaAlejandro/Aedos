const { MAX_FLASH_SLIDES, MAX_PRO_SLIDES, MAX_TOPIC_CHARACTERS } = require('./limits');

const VALID_LANGUAGES = Object.freeze(['es', 'en', 'fr', 'pt', 'de']);

function normalizeMode(body) {
    return body?.mode === 'pro' ? 'pro' : 'flash';
}

function normalizeRequestedLanguage(body) {
    return body?.language || body?.idioma || 'auto';
}

function normalizeValidatedLanguage(body) {
    const idioma = body?.idioma || 'es';
    return VALID_LANGUAGES.includes(idioma)
        ? { valid: true, idioma }
        : { valid: false, fields: { idioma: 'must be one of: es, en, fr, pt, de' } };
}

function normalizeSlides(body) {
    const raw = body?.slides;
    const slides = raw !== undefined && raw !== 'undefined' ? parseInt(raw, 10) : 5;
    if (isNaN(slides) || slides < 1 || slides > MAX_FLASH_SLIDES) {
        return { valid: false, fields: { slides: 'must be integer between 1 and 15' } };
    }
    const maxSlides = normalizeMode(body) === 'pro' ? MAX_PRO_SLIDES : MAX_FLASH_SLIDES;
    return { valid: true, slides: Math.min(slides, maxSlides), requestedSlides: slides, capped: slides > maxSlides };
}

function normalizeSkeletonValue(value) {
    if (!value || typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return value;
    }
}

function normalizeTopic(value, sanitizeTopic) {
    const raw = value || '';
    const result = sanitizeTopic(String(raw));
    if (!result.valid) return result;
    return { valid: true, tema: result.tema.substring(0, MAX_TOPIC_CHARACTERS) };
}

module.exports = {
    VALID_LANGUAGES,
    normalizeMode,
    normalizeRequestedLanguage,
    normalizeValidatedLanguage,
    normalizeSlides,
    normalizeSkeletonValue,
    normalizeTopic,
};
