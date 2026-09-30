if (process.env.NODE_ENV !== 'test') {
    require('dotenv').config();
}
const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const {
    MAX_UPLOAD_ARRAY_FIELDS,
    MAX_TOPIC_CHARACTERS,
    MAX_FLASH_SLIDES,
    MAX_PRO_SLIDES,
    MAX_EXPORT_HTML_BYTES,
    DOWNLOAD_TTL_MS,
} = require('./contracts/limits');
const { ENV_NAMES, DEFAULTS } = require('./contracts/config-defaults');
const { loadEnvConfig } = require('./config/env');
const {
    queueFullGeneration,
    queueFullFinalize,
    proTemporarilyPaused,
    validationFailed,
    invalidTopic,
    ERROR_TEXT,
} = require('./contracts/errors');
const { writeSse, setSseHeaders } = require('./contracts/sse');
const { sanitizeGeneratedHtml: sanitizeGeneratedHtmlMoved } = require('./sanitization/html');
const { TMP_DIR, upload } = require('./files/upload');
const { ensureBackendDirectories } = require('./files/directories');
const { buildSkeletonFileContext, buildGenerationFileContext } = require('./files/attachments');
const { createGenerationQueue } = require('./queues/generation');
const { createFinalizeQueue } = require('./queues/finalize');
const { createPdfExporter } = require('./export/pdf');
const { createPptxFinalizer } = require('./export/pptx-finalize');

// Force Puppeteer to use a visible cache directory BEFORE requiring it.
// This matches the PUPPETEER_CACHE_DIR set in package.json.
process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, '..', '..', 'puppeteer-cache');
const { createBrowserManager } = require('./browser/manager');
const { createPptxRenderer } = require('./export/pptx-renderer');

const { runPipeline, buildLegacyPrompt, extractJson } = require('./prompts/pipeline');
const { createSkeletonHandler } = require('./pipeline/skeleton');
const { createOutlineItemHandler } = require('./pipeline/outline-item');
const { consumeModelStream, runFlashGenerationWithRetry } = require('./pipeline/stream');
const buildPrompt = require('./prompts/base'); // kept for fallback
const { buildStage1Prompt, buildStage1RevisionPrompt } = require('./prompts/stage1-content');
const { buildAddSlidePrompt, buildAddPointPrompt } = require('./prompts/skeleton_prompts');
const { createCorsMiddleware } = require('./http/middleware/cors');
const { createRequestLoggingMiddleware } = require('./http/middleware/request-logging');
const { createSecurityHeadersMiddleware } = require('./http/middleware/security-headers');
const { createCanonicalRedirectMiddleware } = require('./http/middleware/canonical-redirect');
const { createStaticFilesMiddleware } = require('./http/middleware/static-files');
const { registerEntryRoutes } = require('./http/routes/entry');
const { registerGenerationRoutes } = require('./http/routes/generation-endpoints');
const { registerFinalizeRoutes } = require('./http/routes/finalize');
const { registerDownloadRoute } = require('./http/routes/download');

const { createLogger, classifyError, ErrorCategory } = require('./utils/logger');
const { verifyConnection: verifyRedis, checkRateLimits, checkFinalizeLimits } = require('./utils/rate-limiter');

const log = createLogger({ scope: 'SERVER' });
const providerLog = log.child('PROVIDER');
const queueLog = log.child('QUEUE');
const sanitizerLog = log.child('SANITIZER');
const devLog = log.child('DEV');
const imageLog = log.child('IMAGES');
const puppeteerLog = log.child('PUPPETEER');
const runtimeConfig = loadEnvConfig(process.env);
let testProviderOverride = null;
const browserManager = createBrowserManager({
    rootDir: path.join(__dirname, '..', '..'),
    puppeteerLog,
    ErrorCategory
});

const generationQueue = createGenerationQueue({
    runtimeConfig,
    queueLog,
    ErrorCategory,
    queueFullGeneration,
    proTemporarilyPaused,
    writeSse
});
const finalizeQueueState = createFinalizeQueue({
    runtimeConfig,
    puppeteerLog,
    ErrorCategory,
    queueFullFinalize
});
function checkGenerationPressure(req, res, next) {
    return generationQueue.checkPressure(req, res, next);
}

function checkFinalizePressure(req, res, next) {
    return finalizeQueueState.checkPressure(req, res, next);
}

function setTestProviderOverride(provider) {
    if (process.env.NODE_ENV !== 'test' || process.env.AEDOS_TEST_STUB_PROVIDERS !== '1') {
        throw new Error('Test provider override is only available in test mode');
    }
    testProviderOverride = provider;
}

function clearTestProviderOverride() {
    testProviderOverride = null;
}

const AEDOS_LOGO = [
    '  █████╗  ███████╗ ██████╗   ██████╗  ███████╗',
    ' ██╔══██╗ ██╔════╝ ██╔══██╗ ██╔═══██╗ ██╔════╝',
    ' ███████║ █████╗   ██║  ██║ ██║   ██║ ███████╗',
    ' ██╔══██║ ██╔══╝   ██║  ██║ ██║   ██║ ╚════██║',
    ' ██║  ██║ ███████╗ ██████╔╝ ╚██████╔╝ ███████║',
    ' ╚═╝  ╚═╝ ╚══════╝ ╚═════╝   ╚═════╝  ╚══════╝'
];
const SHOULD_PRINT_STARTUP_BANNER = require.main === module;

const app = express();
// Remove server fingerprint header
app.disable('x-powered-by');
// Trust proxies to get real client IPs for rate limiting
app.set('trust proxy', true);
const PORT = runtimeConfig.port;
const RUNTIME_ENV = runtimeConfig.runtimeEnv;
const pdfExporter = createPdfExporter({
    browserManager,
    tmpDir: TMP_DIR,
    port: PORT,
    puppeteerLog,
    log,
    ErrorCategory
});
const renderEditablePptx = createPptxRenderer({
    browserManager,
    port: PORT,
    tmpDir: TMP_DIR,
    puppeteerLog,
    ErrorCategory
});
const pptxFinalizer = createPptxFinalizer({
    tmpDir: TMP_DIR,
    maxExportHtmlBytes: MAX_EXPORT_HTML_BYTES,
    downloadTtlMs: DOWNLOAD_TTL_MS,
    renderEditablePptx,
    log,
    ErrorCategory
});
const IS_DEVELOPMENT = RUNTIME_ENV === 'development';
const EXAMPLES_DIR = path.join(__dirname, '..', '..', 'examples');
const EXAMPLES_FLASH_DIR = path.join(EXAMPLES_DIR, 'flash');
const EXAMPLES_PRO_DIR = path.join(EXAMPLES_DIR, 'pro');


// Global fallback list for OpenRouter when callOpenRouter is invoked without
// an explicit stage list. Keep Stage3-only models (like minimax) out of here.
function parseModelList(rawValue, fallbackCsv) {
    return (rawValue || fallbackCsv)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

// OpenRouter fallback model lists (read from .env)
const OPENROUTER_MODELS_FLASH = parseModelList(
    process.env[ENV_NAMES.OPENROUTER_MODELS_FLASH],
    DEFAULTS.OPENROUTER_MODELS_FLASH
);
const OPENROUTER_MODELS_STAGE1 = parseModelList(
    process.env[ENV_NAMES.OPENROUTER_MODELS_STAGE1],
    DEFAULTS.OPENROUTER_MODELS_STAGE1
);
const OPENROUTER_MODELS_STAGE2 = parseModelList(
    process.env[ENV_NAMES.OPENROUTER_MODELS_STAGE2],
    DEFAULTS.OPENROUTER_MODELS_STAGE2
);
const OPENROUTER_MODELS_STAGE3 = parseModelList(
    process.env[ENV_NAMES.OPENROUTER_MODELS_STAGE3],
    DEFAULTS.OPENROUTER_MODELS_STAGE3
);

const OPENROUTER_MODEL_LIST = OPENROUTER_MODELS_FLASH;

// Models that must never run outside Stage3 (configured in .env).
const OPENROUTER_MODELS_STAGE3_ONLY = parseModelList(
    process.env[ENV_NAMES.OPENROUTER_MODELS_STAGE3_ONLY],
    DEFAULTS.OPENROUTER_MODELS_STAGE3_ONLY
).map(model => String(model).trim().toLowerCase());

// Per-stage reasoning effort for OpenRouter fallback.
// Accepted values: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
// Not all models support all values — OpenRouter ignores unsupported efforts.
// DeepSeek V4 Flash specifically supports 'high' and 'xhigh' only, but we
// keep 'low' / 'medium' here because the user asked for them and the
// upstream layer maps unsupported efforts to a sensible default.
const OPENROUTER_REASONING_FLASH  = (process.env.OPENROUTER_REASONING_FLASH  || 'low').trim().toLowerCase();
const OPENROUTER_REASONING_STAGE1 = (process.env.OPENROUTER_REASONING_STAGE1 || 'medium').trim().toLowerCase();
const OPENROUTER_REASONING_STAGE2 = (process.env.OPENROUTER_REASONING_STAGE2 || 'medium').trim().toLowerCase();
const OPENROUTER_REASONING_STAGE3 = (process.env.OPENROUTER_REASONING_STAGE3 || 'medium').trim().toLowerCase();

const VALID_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

function reasoningForStage(stageName) {
    let effort;
    switch (stageName) {
        case 'Flash':  effort = OPENROUTER_REASONING_FLASH;  break;
        case 'Stage1': effort = OPENROUTER_REASONING_STAGE1; break;
        case 'Stage2': effort = OPENROUTER_REASONING_STAGE2; break;
        case 'Stage3': effort = OPENROUTER_REASONING_STAGE3; break;
        default:       effort = 'low';
    }
    if (!VALID_REASONING_EFFORTS.has(effort)) effort = 'low';
    // 'none' maps to enabled:false in OpenRouter's reasoning object
    if (effort === 'none') return null;
    return { effort };
}

// Gemini direct API primary models (read from .env)
const GEMINI_MODEL_FLASH  = (process.env[ENV_NAMES.GEMINI_MODELS_FLASH]  || DEFAULTS.GEMINI_MODELS_FLASH).trim();
const GEMINI_MODEL_STAGE1 = (process.env[ENV_NAMES.GEMINI_MODELS_STAGE1] || DEFAULTS.GEMINI_MODELS_STAGE1).trim();
const GEMINI_MODEL_STAGE2 = (process.env[ENV_NAMES.GEMINI_MODELS_STAGE2] || DEFAULTS.GEMINI_MODELS_STAGE2).trim();
const GEMINI_MODEL_STAGE3 = (process.env[ENV_NAMES.GEMINI_MODELS_STAGE3] || DEFAULTS.GEMINI_MODELS_STAGE3).trim();

// Rate limiting is handled by Upstash Redis (see utils/rate-limiter.js).
// checkRateLimits   → daily limits + cooldown for /generate
// checkFinalizeLimits → window limit for /finalize

if (SHOULD_PRINT_STARTUP_BANNER) {
    log.banner(AEDOS_LOGO, 'cyan');
}

app.use(createCorsMiddleware({ log, ErrorCategory }));

function validateEnvironment() {
    const checks = [
        { key: 'NODE_ENV', value: process.env.NODE_ENV, fallback: 'development' },
        { key: 'PORT', value: process.env.PORT, fallback: '3000' },
    ];

    log.info(ErrorCategory.BOOT, 'Environment validation started');
    checks.forEach(({ key, value, fallback }) => {
        const val = value || fallback;
        if (value) {
            log.info(ErrorCategory.CONFIG, 'Environment variable detected', { key, value: val });
            return;
        }
        log.warn(ErrorCategory.CONFIG, 'Environment variable missing, using fallback', {
            key,
            fallback: val
        });
    });

    if (process.env.GEMINI_API_KEY) {
        log.success(ErrorCategory.CONFIG, 'Gemini direct API key present (primary provider)', {
            flash:  GEMINI_MODEL_FLASH,
            stage1: GEMINI_MODEL_STAGE1,
            stage2: GEMINI_MODEL_STAGE2,
            stage3: GEMINI_MODEL_STAGE3
        });
    } else {
        log.warn(ErrorCategory.CONFIG, 'GEMINI_API_KEY not set — direct Gemini calls will be skipped');
    }

    if (process.env.OPENROUTER_API_KEY) {
        log.success(ErrorCategory.CONFIG, 'OpenRouter API key present (fallback provider)', {
            flash:  OPENROUTER_MODELS_FLASH,
            stage1: OPENROUTER_MODELS_STAGE1,
            stage2: OPENROUTER_MODELS_STAGE2,
            stage3: OPENROUTER_MODELS_STAGE3
        });
    } else {
        log.warn(ErrorCategory.CONFIG, 'OPENROUTER_API_KEY not set — OpenRouter fallback disabled');
    }

    if (!process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY) {
        throw new Error('At least one of GEMINI_API_KEY or OPENROUTER_API_KEY is required.');
    }
}

validateEnvironment();

app.use(createRequestLoggingMiddleware({ log, ErrorCategory }));

app.use(createSecurityHeadersMiddleware());

// Redirect the raw Render URL to the canonical domain BEFORE static files are
// served. express.static intercepts GET / and sends index.html directly,
// bypassing any app.get('/') route handler registered afterwards.
if ((process.env.NODE_ENV || 'development') === 'production') {
    app.use(createCanonicalRedirectMiddleware());
}

app.use(createStaticFilesMiddleware({
    frontendDir: path.join(__dirname, '..', 'frontend'),
    isDevelopment: IS_DEVELOPMENT
}));



function ensureDirectory(dirPath, description) {
    if (fs.existsSync(dirPath)) return;
    fs.mkdirSync(dirPath, { recursive: true });
    log.info(ErrorCategory.FILESYSTEM, `${description} directory created`, { path: dirPath });
}

// Create output folders used for local debug artifacts.
ensureBackendDirectories({
    tmpDir: TMP_DIR,
    examplesDir: EXAMPLES_DIR,
    examplesFlashDir: EXAMPLES_FLASH_DIR,
    examplesProDir: EXAMPLES_PRO_DIR,
    isDevelopment: IS_DEVELOPMENT,
    ensureDirectory
});

// Sanitizer implementation moved to sanitization/html.js.
const sanitizeGeneratedHtml = sanitizeGeneratedHtmlMoved;

function injectLayoutSafetyNet(html) {
    if (typeof html !== 'string' || /aedos-layout-safety-net/.test(html)) return html;

    const safetyCss = `
/* aedos-layout-safety-net */
section.s[style*='flex-direction:row'] .flex-col:has(> .card:nth-of-type(3)) {
    display:grid !important;
    grid-template-columns:repeat(2,minmax(0,1fr)) !important;
    align-content:start !important;
}
section.s[style*='flex-direction:row'] .flex-col:has(> .card:nth-of-type(5)) {
    grid-template-columns:repeat(3,minmax(0,1fr)) !important;
}
section.s[style*='flex-direction:row'] .flex-col:has(> .card:nth-of-type(3)) > .card {
    min-width:0 !important;
}
`;

    if (/<\/style>/i.test(html)) {
        return html.replace(/<\/style>/i, `${safetyCss}\n</style>`);
    }
    return `${html}\n<style>${safetyCss}\n</style>`;
}

function decodeBasicHtmlEntities(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function normalizeTextContent(value) {
    return decodeBasicHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

function extractPresentationTitle(html) {
    if (typeof html !== 'string') return '';

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) return normalizeTextContent(titleMatch[1]);

    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match && h1Match[1]) return normalizeTextContent(h1Match[1]);

    const configTitleMatch = html.match(/"title"\s*:\s*"([^"]+)"/i);
    if (configTitleMatch && configTitleMatch[1]) return configTitleMatch[1].trim();

    return '';
}

function buildFileStemFromTitle(title) {
    const stem = String(title || 'presentation')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 90);
    return stem || 'presentation';
}

function resolveUniqueHtmlPath(dirPath, stem) {
    let candidate = path.join(dirPath, `${stem}.html`);
    let index = 2;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dirPath, `${stem}-${index}.html`);
        index += 1;
    }
    return candidate;
}

// ── Gemini direct API (primary) ───────────────────────────────────────────────

const { fetchWithAcceptTimeout } = require('./providers/common');
const { createGeminiProvider } = require('./providers/gemini');
const { createOpenRouterProvider } = require('./providers/openrouter');
const { createProviderFallback, createTestProviderResponse } = require('./providers/fallback');

const PROVIDER_ACCEPT_TIMEOUT_MS = runtimeConfig.providerAcceptTimeoutMs;
const geminiProvider = createGeminiProvider({
    fetchWithAcceptTimeout,
    providerLog,
    ErrorCategory,
    providerAcceptTimeoutMs: PROVIDER_ACCEPT_TIMEOUT_MS
});
const openRouterProvider = createOpenRouterProvider({
    fetchWithAcceptTimeout,
    providerLog,
    classifyError,
    ErrorCategory,
    providerAcceptTimeoutMs: PROVIDER_ACCEPT_TIMEOUT_MS,
    modelList: OPENROUTER_MODEL_LIST,
    stage3Only: OPENROUTER_MODELS_STAGE3_ONLY,
    reasoningForStage
});
const providerFallback = createProviderFallback({
    gemini: geminiProvider.call,
    openrouter: openRouterProvider.call,
    getOverride: () => testProviderOverride,
    createStub: createTestProviderResponse,
    providerLog,
    ErrorCategory
});
const tryModelsFlash = providerFallback.makeCaller('Flash', GEMINI_MODEL_FLASH, OPENROUTER_MODELS_FLASH);
const tryModelsStage1 = providerFallback.makeCaller('Stage1', GEMINI_MODEL_STAGE1, OPENROUTER_MODELS_STAGE1);
const tryModelsStage2 = providerFallback.makeCaller('Stage2', GEMINI_MODEL_STAGE2, OPENROUTER_MODELS_STAGE2);
const tryModelsStage3 = providerFallback.makeCaller('Stage3', GEMINI_MODEL_STAGE3, OPENROUTER_MODELS_STAGE3);
const tryModelsFlashThinking = (prompt, fileContext) => tryModelsFlash(prompt, fileContext, { includeReasoning: true });
const tryModelsStage1Thinking = (prompt, fileContext) => tryModelsStage1(prompt, fileContext, { includeReasoning: true });
const tryModelsStage2Thinking = (prompt, fileContext) => tryModelsStage2(prompt, fileContext, { includeReasoning: true });
const tryModelsStage3Thinking = (prompt, fileContext) => tryModelsStage3(prompt, fileContext, { includeReasoning: true });
const tryModels = tryModelsFlash;

const handleGenerateSkeleton = createSkeletonHandler({
    sanitizeTema: (input) => sanitizeTema(input),
    buildSkeletonFileContext,
    buildStage1Prompt,
    buildStage1RevisionPrompt,
    tryModelsStage1Thinking,
    extractJson,
    setSseHeaders,
    writeSse,
    invalidTopic,
    ERROR_TEXT,
    MAX_PRO_SLIDES,
    MAX_FLASH_SLIDES,
    log,
    ErrorCategory
});
const handleGenerateOutlineItem = createOutlineItemHandler({
    buildAddSlidePrompt,
    buildAddPointPrompt,
    tryModelsStage1,
    extractJson,
    ERROR_TEXT,
    log,
    ErrorCategory
});

browserManager.initBrowser();

// Close Puppeteer securely when the server terminates
process.on('SIGINT', async () => {
    log.info(ErrorCategory.BOOT, 'SIGINT received, shutting down gracefully');
    await browserManager.close();
    process.exit();
});

// Routes
registerEntryRoutes({ app, tmpDir: TMP_DIR });



function sanitizeTema(input) {
    if (typeof input !== 'string') return { valid: false, reason: "Topic must be a string" };

    if (/<[^>]+>/.test(input) ||
        /javascript:/i.test(input) ||
        /onerror\s*=/i.test(input) ||
        /onload\s*=/i.test(input) ||
        /eval\s*\(/i.test(input) ||
        /document\.cookie/i.test(input) ||
        /window\.location/i.test(input) ||
        /fetch\s*\(/i.test(input) ||
        /innerHTML/i.test(input)) {
        return { valid: false, reason: "HTML/script content not allowed" };
    }

    const restrictedPatterns = [
        "ignore previous", "ignore all", "system prompt",
        "you are now", "act as", "disregard", "reveal your",
        "print your instructions", "forget your", "new instruction"
    ];

    const lowerInput = input.toLowerCase();
    for (const pattern of restrictedPatterns) {
        if (lowerInput.includes(pattern)) {
            return { valid: false, reason: "Contains restricted patterns" };
        }
    }

    const cleanedString = input.trim().replace(/\s+/g, ' ').substring(0, MAX_TOPIC_CHARACTERS);
    return { valid: true, tema: cleanedString };
}

registerGenerationRoutes({
    app,
    upload,
    maxUploadArrayFields: MAX_UPLOAD_ARRAY_FIELDS,
    checkGenerationPressure,
    checkRateLimits,
    handleGenerateSkeleton,
    handleGenerateOutlineItem,
    generationQueue,
    runPipeline,
    runFlashGenerationWithRetry,
    tryModelsFlash,
    tryModelsStage1Thinking,
    tryModelsStage2Thinking,
    tryModelsStage3Thinking,
    buildPrompt,
    buildGenerationFileContext,
    sanitizeTema,
    invalidTopic,
    validationFailed,
    ERROR_TEXT,
    MAX_PRO_SLIDES,
    MAX_FLASH_SLIDES,
    setSseHeaders,
    log,
    ErrorCategory,
    fs,
    path,
    TMP_DIR,
    devLog,
    classifyError,
    consumeModelStream,
    sanitizeGeneratedHtml,
    injectLayoutSafetyNet,
    sanitizerLog,
    IS_DEVELOPMENT,
    extractPresentationTitle,
    buildFileStemFromTitle,
    resolveUniqueHtmlPath,
    EXAMPLES_FLASH_DIR,
    EXAMPLES_PRO_DIR
});


registerFinalizeRoutes({
    app,
    checkFinalizePressure,
    checkFinalizeLimits,
    finalizeQueueState,
    pptxFinalizer,
    pdfExporter,
    maxExportHtmlBytes: MAX_EXPORT_HTML_BYTES,
    downloadTtlMs: DOWNLOAD_TTL_MS,
    log,
    puppeteerLog,
    classifyError,
    ErrorCategory
});
registerDownloadRoute({ app, tmpDir: TMP_DIR, log, classifyError, ErrorCategory });

// ── Global process safety net ─────────────────────────────────────────────
// Long-lived SSE responses make socket-level failures (EPIPE / aborted /
// client disconnect) common. Node's default behavior when an 'error' event
// has no listener — or a promise rejection is unhandled — is to terminate the
// process. On Render that surfaces as a random "crash": a generation dies
// mid-stream and the whole service restarts mid-request. We keep the process
// alive and log instead; the per-request res.on('error') handlers unwind the
// affected loop gracefully while unrelated requests keep working.
process.on('uncaughtException', (err) => {
    try {
        log.error(ErrorCategory.UNKNOWN, 'Uncaught exception caught, process kept alive', {
            error: err && err.stack
                ? String(err.stack).split('\n').slice(0, 6).join(' | ')
                : String(err)
        });
    } catch (_) { /* logging must never crash */ }
});

process.on('unhandledRejection', (reason) => {
    try {
        log.error(ErrorCategory.UNKNOWN, 'Unhandled promise rejection caught, process kept alive', {
            error: reason && reason.stack
                ? String(reason.stack).split('\n').slice(0, 6).join(' | ')
                : String(reason)
        });
    } catch (_) { /* logging must never crash */ }
});

if (require.main === module) {
    // Verify Upstash connection before accepting traffic
    verifyRedis().then((ok) => {
        if (!ok) {
            log.warn(ErrorCategory.BOOT,
                'Upstash Redis is NOT connected — rate limiting will be DISABLED');
        }

        const server = app.listen(PORT, () => {
            log.success(ErrorCategory.BOOT, 'Aedos server started', {
                url: `http://localhost:${PORT}`,
                env: process.env.NODE_ENV || 'development',
                rateLimiting: ok ? 'upstash' : 'disabled',
            });
        });

        // Allow long-running AI generations before Node gives up on the request.
                server.requestTimeout = DOWNLOAD_TTL_MS;
        server.headersTimeout = 11 * 60 * 1000;
    });
}

module.exports = {
    app,
    sanitizeTema,
    sanitizeGeneratedHtml,
    buildPrompt,
    setTestProviderOverride,
    clearTestProviderOverride,
};
