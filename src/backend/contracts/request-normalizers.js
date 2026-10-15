const { MAX_FLASH_SLIDES, MAX_PRO_SLIDES, MAX_TOPIC_CHARACTERS } = require('./limits');

const VALID_LANGUAGES = Object.freeze(['auto', 'es', 'en', 'fr', 'pt', 'de', 'it', 'zh', 'ja', 'ru', 'ar']);

function normalizeLanguageValue(value) {
    if (value === undefined || value === null || String(value).trim() === '') return 'auto';
    const raw = String(value).trim().toLowerCase().replace('_', '-');
    if (raw === 'automatic' || raw === 'autodetect' || raw === 'auto-detect') return 'auto';
    const language = raw.split('-')[0];
    return VALID_LANGUAGES.includes(language) ? language : null;
}

function normalizeMode(body) {
    return body?.mode === 'pro' || body?.generationMode === 'pro' ? 'pro' : 'flash';
}

function normalizeRequestedLanguage(body) {
    return normalizeLanguageValue(body?.language ?? body?.idioma);
}

function normalizeValidatedLanguage(body) {
    const idioma = normalizeRequestedLanguage(body);
    return idioma
        ? { valid: true, idioma }
        : { valid: false, fields: { idioma: `must be one of: ${VALID_LANGUAGES.join(', ')}` } };
}

function normalizeSlides(body) {
    const raw = body?.slides;
    const missing = raw === undefined || raw === 'undefined';
    const validType = typeof raw === 'number' || typeof raw === 'string' && /^\s*\d+\s*$/.test(raw);
    const slides = missing ? 5 : validType ? Number(raw) : NaN;
    const maxSlides = normalizeMode(body) === 'pro' ? MAX_PRO_SLIDES : MAX_FLASH_SLIDES;
    if (!Number.isSafeInteger(slides) || slides < 1 || slides > maxSlides) {
        return { valid: false, fields: { slides: `must be an integer between 1 and ${maxSlides}` }, maxSlides };
    }
    return { valid: true, slides, requestedSlides: slides, maxSlides };
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
    normalizeLanguageValue,
    normalizeValidatedLanguage,
    normalizeSlides,
    normalizeSkeletonValue,
    normalizeTopic,
};
