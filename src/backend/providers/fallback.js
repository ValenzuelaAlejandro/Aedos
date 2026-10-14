/**
 * Create the provider fallback router and test-only deterministic provider.
 * @param {{gemini: Function, openrouter: Function, getOverride: Function, createStub: Function, providerLog: {warn: Function}, ErrorCategory: Record<string, string>}} deps provider implementations and seam
 * @returns {{makeCaller: Function}}
 */
const { FREE_MODELS, PAID_MODELS } = require('../config/provider-spend');
const { MODEL_CATALOG } = require('../config/model-catalog');

function publicModelId(providerModelId) {
    return Object.values(MODEL_CATALOG).find(model => model.providerModelId === providerModelId)?.id || providerModelId;
}

function fallbackReason(error) {
    const rules = [
        [() => typeof error?.fallbackReason === 'string', () => error.fallbackReason],
        [() => error?.message === 'GEMINI_APP_CAP_REACHED', () => 'gemini_quota_exhausted'],
        [() => ['GEMINI_ACCEPT_TIMEOUT', 'OPENROUTER_ACCEPT_TIMEOUT'].includes(error?.message), () => 'timeout'],
        [() => /HTTP_429/.test(error?.message || ''), () => 'rate_limited'],
        [() => /HTTP_5\d\d/.test(error?.message || ''), () => 'provider_5xx'],
        [() => error?.message === 'PAID_PAUSED', () => 'paid_paused']
    ];
    const rule = rules.find(([matches]) => matches());
    return rule ? rule[1]() : 'provider_unavailable';
}

function routeOptions(options, effectiveModelId, reason) {
    if (!options?.modelRoute) return options;
    return { ...options, modelRoute: { ...options.modelRoute, effectiveModelId, fallbackReason: reason } };
}

function withRoute(result, options, effectiveModelId, reason) {
    if (!options?.modelRoute) return result;
    const effective = result?.provider === 'openrouter' && result.model ? result.model : effectiveModelId;
    return { ...result, modelRoute: { ...options.modelRoute, effectiveModelId: effective, fallbackReason: reason } };
}

async function tryGemini({ gemini, providerLog, ErrorCategory, prompt, stageName, geminiModel, fileContext, options }) {
    if (!process.env.GEMINI_API_KEY) return null;
    try {
        const route = routeOptions(options, publicModelId(geminiModel),
            options?.modelRoute?.fallbackReason || null);
        const result = await gemini(prompt, stageName, geminiModel, fileContext, route);
        return { result: withRoute(result, options, publicModelId(geminiModel), route?.modelRoute?.fallbackReason || null) };
    } catch (error) {
        providerLog.warn(ErrorCategory.PROVIDER, 'Gemini direct failed, falling back to OpenRouter', {
            stage: stageName, model: geminiModel, fallbackReason: fallbackReason(error)
        });
        return { error };
    }
}

async function tryFree({ openrouter, providerLog, ErrorCategory, prompt, stageName, fileContext, options, reason }) {
    try {
        const route = routeOptions(options, publicModelId(FREE_MODELS[0]), reason || 'gemini_unavailable');
        const result = await openrouter(prompt, stageName, FREE_MODELS, fileContext, route);
        return { result: withRoute(result, options, publicModelId(FREE_MODELS[0]), reason || 'gemini_unavailable') };
    } catch (error) {
        providerLog.warn(ErrorCategory.PROVIDER, 'Approved OpenRouter free route unavailable', {
            stage: stageName, fallbackReason: fallbackReason(error)
        });
        return { error };
    }
}

async function callPaidAfterFree({ openrouter, openrouterModels, prompt, stageName, fileContext, options, reason }) {
    const paidModels = (openrouterModels || []).filter(model => PAID_MODELS[String(model).toLowerCase()]);
    if (!paidModels.length) throw new Error('PROVIDER_UNAVAILABLE');
    const route = routeOptions(options, paidModels[0], reason || 'free_route_unavailable');
    return withRoute(await openrouter(prompt, stageName, paidModels, fileContext, route), options,
        paidModels[0], reason || 'free_route_unavailable');
}

function blockedAttachmentFallback(fileContext, options, direct) {
    if (!fileContext?.length || !options?.attachmentsRequireGemini || direct?.result) return null;
    const error = new Error('ATTACHMENTS_NOT_ALLOWED');
    if (direct?.error) error.cause = direct.error;
    return error;
}

function selectedFallbackReason(options, direct) {
    if (options?.modelRoute?.fallbackReason) return options.modelRoute.fallbackReason;
    if (direct?.error) return fallbackReason(direct.error);
    return options?.modelRoute ? 'gemini_unavailable' : null;
}

async function tryFreeThenPaid(args) {
    const free = await tryFree({ ...args, reason: args.reason });
    if (free.result) return free.result;
    if (free.error?.message === 'PAID_PAUSED') throw free.error;
    return callPaidAfterFree(args);
}

async function continueAfterGemini({ openrouter, providerLog, ErrorCategory, prompt, stageName,
    openrouterModels, fileContext, options, direct }) {
    const attachmentError = blockedAttachmentFallback(fileContext, options, direct);
    if (attachmentError) throw attachmentError;
    const reason = selectedFallbackReason(options, direct);
    return tryFreeThenPaid({ openrouter, providerLog, ErrorCategory, prompt, stageName,
        openrouterModels, fileContext, options, reason });
}

async function callConfiguredProviders({ gemini, openrouter, providerLog, ErrorCategory, prompt, stageName,
    geminiModel, openrouterModels, fileContext, options }) {
    const direct = await tryGemini({ gemini, providerLog, ErrorCategory, prompt, stageName,
        geminiModel, fileContext, options });
    if (direct?.result) return direct.result;
    return continueAfterGemini({ openrouter, providerLog, ErrorCategory, prompt, stageName,
        openrouterModels, fileContext, options, direct });
}

function createProviderFallback({ gemini, openrouter, getOverride, createStub, providerLog, ErrorCategory }) {
    async function callWithFallback(prompt, stageName, geminiModel, openrouterModels, fileContext = null, options = null) {
        const testOverride = getOverride();
        if (process.env.NODE_ENV === 'test' && process.env.AEDOS_TEST_STUB_PROVIDERS === '1' && testOverride) {
            return testOverride({ prompt, stageName, geminiModel, openrouterModels, fileContext, options });
        }
        if (process.env.NODE_ENV !== 'production' && process.env.AEDOS_TEST_STUB_PROVIDERS === '1') return createStub(stageName, options);
        return callConfiguredProviders({ gemini, openrouter, providerLog, ErrorCategory, prompt, stageName,
            geminiModel, openrouterModels, fileContext, options });
    }

    function makeCaller(stageName, geminiModel, openrouterModels) {
        return (prompt, fileContext = null, options = null) =>
            callWithFallback(prompt, stageName, geminiModel, openrouterModels, fileContext, options);
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
