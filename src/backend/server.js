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
    MAX_FLASH_SLIDES,
    MAX_PRO_SLIDES,
    MAX_EXPORT_HTML_BYTES,
    DOWNLOAD_TTL_MS,
} = require('./contracts/limits');
const { createModelConfig } = require('./config/models');
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
const { sanitizeTema } = require('./contracts/topic-sanitizer');
const { sanitizeGeneratedHtml: sanitizeGeneratedHtmlMoved } = require('./sanitization/html');
const { TMP_DIR, upload } = require('./files/upload');
const { createDirectoryEnsurer, ensureBackendDirectories } = require('./files/directories');
const { extractPresentationTitle, buildFileStemFromTitle, resolveUniqueHtmlPath } = require('./files/content');
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
const { registerBackendRoutes } = require('./http/register-routes');

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


const {
    OPENROUTER_MODELS_FLASH,
    OPENROUTER_MODELS_STAGE1,
    OPENROUTER_MODELS_STAGE2,
    OPENROUTER_MODELS_STAGE3,
    OPENROUTER_MODEL_LIST,
    OPENROUTER_MODELS_STAGE3_ONLY,
    GEMINI_MODEL_FLASH,
    GEMINI_MODEL_STAGE1,
    GEMINI_MODEL_STAGE2,
    GEMINI_MODEL_STAGE3,
    reasoningForStage
} = createModelConfig(process.env);
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



// Create output folders used for local debug artifacts.
const ensureDirectory = createDirectoryEnsurer({ log, ErrorCategory });
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

// ── Gemini direct API (primary) ───────────────────────────────────────────────
const { createProviderRuntime } = require('./providers/runtime');
const {
    tryModelsFlash,
    tryModelsStage1,
    tryModelsFlashThinking,
    tryModelsStage1Thinking,
    tryModelsStage2Thinking,
    tryModelsStage3Thinking
} = createProviderRuntime({
    runtimeConfig,
    providerLog,
    classifyError,
    ErrorCategory,
    modelConfig: {
        OPENROUTER_MODEL_LIST,
        OPENROUTER_MODELS_STAGE3_ONLY,
        OPENROUTER_MODELS_FLASH,
        OPENROUTER_MODELS_STAGE1,
        OPENROUTER_MODELS_STAGE2,
        OPENROUTER_MODELS_STAGE3,
        GEMINI_MODEL_FLASH,
        GEMINI_MODEL_STAGE1,
        GEMINI_MODEL_STAGE2,
        GEMINI_MODEL_STAGE3,
        reasoningForStage
    },
    getTestProviderOverride: () => testProviderOverride
});

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

registerBackendRoutes({
    app,
    TMP_DIR,
    upload,
    MAX_UPLOAD_ARRAY_FIELDS,
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
    EXAMPLES_PRO_DIR,
    checkFinalizePressure,
    checkFinalizeLimits,
    finalizeQueueState,
    pptxFinalizer,
    pdfExporter,
    MAX_EXPORT_HTML_BYTES,
    DOWNLOAD_TTL_MS,
    puppeteerLog
});

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
