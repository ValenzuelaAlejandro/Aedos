/**
 * Create the provider fallback router and test-only deterministic provider.
 * @param {{gemini: Function, openrouter: Function, getOverride: Function, createStub: Function, providerLog: {warn: Function}, ErrorCategory: Record<string, string>}} deps provider implementations and seam
 * @returns {{makeCaller: Function}}
 */
function createProviderFallback({ gemini, openrouter, getOverride, createStub, providerLog, ErrorCategory }) {
    async function callWithFallback(prompt, stageName, geminiModel, openrouterModels, fileContext = null, options = null) {
        const testOverride = getOverride();
        if (process.env.NODE_ENV === 'test' && process.env.AEDOS_TEST_STUB_PROVIDERS === '1' && testOverride) {
            return testOverride({ prompt, stageName, geminiModel, openrouterModels, fileContext, options });
        }
        if (process.env.NODE_ENV !== 'production' && process.env.AEDOS_TEST_STUB_PROVIDERS === '1') return createStub(stageName, options);
        if (process.env.GEMINI_API_KEY) {
            try { return await gemini(prompt, stageName, geminiModel, fileContext, options); }
            catch (err) {
                providerLog.warn(ErrorCategory.PROVIDER, 'Gemini direct failed, falling back to OpenRouter', {
                    stage: stageName,
                    model: geminiModel,
                    error: err.message
                });
            }
        }
        return openrouter(prompt, stageName, openrouterModels, fileContext, options);
    }
    function makeCaller(stageName, geminiModel, openrouterModels) {
        return async (prompt, fileContext = null, options = null) => callWithFallback(prompt, stageName, geminiModel, openrouterModels, fileContext, options);
    }
    return { makeCaller };
}

function createTestProviderResponse(stageName, options = null) {
    const structured = Boolean(options && options.includeReasoning);
    let output;
    if (stageName === 'Stage1') {
        output = structured
            ? JSON.stringify({ slide_count: 1, slides: [{ title: 'Test slide', subtitle: 'Test subtitle', role: 'concept', key_points: ['Test point'] }] })
            : JSON.stringify({ title: 'Test slide', role: 'concept', key_points: ['Test point'] });
    } else if (stageName === 'Stage2') {
        output = JSON.stringify({ palette: { background: '#ffffff', text: '#111111', accent: '#3366ff', colors_hex: ['#3366ff', '#111111'] }, typography: { heading: 'Arial', body: 'Arial' }, slides: [] });
    } else {
        output = '<!doctype html><html><head><meta charset="utf-8"><style>section.s{width:1280px;height:720px}</style></head><body><section class="s"><h1>Test presentation</h1></section></body></html>';
    }
    async function* stream() {
        if (structured) yield { type: 'reasoning', text: 'test reasoning' };
        yield structured ? { type: 'text', text: output } : output;
    }
    return { provider: 'test', model: 'stub', stream: stream() };
}

module.exports = { createProviderFallback, createTestProviderResponse };
