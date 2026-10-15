const { extractJson } = require('../prompts/json-extraction');

function isContentPlanOrItem(parsed) {
    return parsed.slides?.length || parsed.action === 'proceed'
        || typeof parsed.title === 'string' || typeof parsed.point === 'string';
}

function validateJsonShape(stage, parsed, options) {
    if (!parsed || typeof parsed !== 'object') throw new Error('PROVIDER_INVALID_OUTPUT');
    if (parsed.rejected) throw new Error('PROVIDER_SAFETY');
    if (options.expectedOutput === 'outline' && !(parsed.slides?.length || parsed.action === 'proceed')) throw new Error('PROVIDER_INVALID_OUTPUT');
    if (stage === 'Stage1' && !isContentPlanOrItem(parsed)) throw new Error('PROVIDER_INVALID_OUTPUT');
    if (stage === 'Stage2' && (!parsed.palette || !Array.isArray(parsed.slides))) throw new Error('PROVIDER_INVALID_OUTPUT');
}

/** Reject unusable completed output before marking the streamed route successful. */
function validateStageOutput(stage, content, options = {}) {
    if (stage === 'Stage1' || stage === 'Stage2') {
        let parsed;
        try { parsed = extractJson(content); } catch (cause) { throw new Error('PROVIDER_INVALID_OUTPUT', { cause }); }
        validateJsonShape(stage, parsed, options);
    } else if (!/<style[\s\S]*?(?:section\.s|--bg)[\s\S]*?<\/style>/i.test(content) || !/<section\b/i.test(content)) {
        throw new Error('PROVIDER_INVALID_OUTPUT');
    } else if (Number.isSafeInteger(options.expectedMaxSlides)) {
        const slideCount = [...content.matchAll(/<section\b[^>]*\bclass=(['"])[^'"]*\bs\b[^'"]*\1[^>]*>/gi)].length;
        if (slideCount > options.expectedMaxSlides) throw new Error('PROVIDER_INVALID_OUTPUT');
    }
}

module.exports = { validateStageOutput };
