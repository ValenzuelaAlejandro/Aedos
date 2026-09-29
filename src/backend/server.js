if (process.env.NODE_ENV !== 'test') {
    require('dotenv').config();
}
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
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
const { registerDownloadRoute } = require('./files/download-route');
const { buildSkeletonFileContext, buildGenerationFileContext } = require('./files/attachments');

// Force Puppeteer to use a visible cache directory BEFORE requiring it.
// This matches the PUPPETEER_CACHE_DIR set in package.json.
process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, '..', '..', 'puppeteer-cache');
const puppeteer = require('puppeteer');
const {
    createEditablePptx,
    SLIDE_W_PX,
    SLIDE_H_PX,
    SLIDE_WIDTH,
    SLIDE_HEIGHT,
    TEXT_WIDTH_SAFETY,
    resolveFontFamily,
    createFontWarningCollector,
    compareZKeys,
    parseCssGradient,
    pxToEmu
} = require('./utils/pptx-export');

const { runPipeline, buildLegacyPrompt, extractJson } = require('./prompts/pipeline');
const buildPrompt = require('./prompts/base'); // kept for fallback
const { buildStage1Prompt, buildStage1RevisionPrompt } = require('./prompts/stage1-content');
const { buildAddSlidePrompt, buildAddPointPrompt } = require('./prompts/skeleton_prompts');

const { createLogger, classifyError, ErrorCategory } = require('./utils/logger');
const { normalizeExportWarning, countExportWarnings } = require('./utils/export-warnings');
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
const IS_DEVELOPMENT = RUNTIME_ENV === 'development';
const EXAMPLES_DIR = path.join(__dirname, '..', '..', 'examples');
const EXAMPLES_FLASH_DIR = path.join(EXAMPLES_DIR, 'flash');
const EXAMPLES_PRO_DIR = path.join(EXAMPLES_DIR, 'pro');
let requestSequence = 0;

// Queue System State
let activeGenerations = 0;
const queue = [];
// Max concurrent generations 
const MAX_CONCURRENT_GENERATIONS = runtimeConfig.maxConcurrentGenerations;
const MAX_QUEUE_DEPTH = runtimeConfig.maxQueueDepth;
const PRO_PAUSE_QUEUE_DEPTH = runtimeConfig.proPauseQueueDepth;
const PRO_PAUSE_ACTIVE_GENERATIONS = runtimeConfig.proPauseActiveGenerations;
const PRESSURE_RETRY_AFTER_SEC = runtimeConfig.pressureRetryAfterSec;

// Puppeteer System State
let activeFinalize = 0;
const finalizeQueue = [];
const PUPPETEER_MAX_CONCURRENT = runtimeConfig.puppeteerMaxConcurrent;
const PUPPETEER_MAX_QUEUE = runtimeConfig.puppeteerMaxQueue;

function processFinalizeQueue() {
    if (finalizeQueue.length > 0 && activeFinalize < PUPPETEER_MAX_CONCURRENT) {
        const item = finalizeQueue.shift();
        activeFinalize++;
        item.resolve();
        puppeteerLog.info(ErrorCategory.QUEUE, 'Puppeteer queued request resumed', {
            activeFinalize,
            queueDepth: finalizeQueue.length
        });
    }
}

function checkFinalizePressure(req, res, next) {
    if (
        activeFinalize >= PUPPETEER_MAX_CONCURRENT &&
        finalizeQueue.length >= PUPPETEER_MAX_QUEUE
    ) {
        puppeteerLog.warn(ErrorCategory.QUEUE, 'Puppeteer queue full - request rejected', {
            requestId: req.requestId,
            ip: req.ip,
            activeFinalize,
            queueDepth: finalizeQueue.length
        });
        return res.status(429).json(queueFullFinalize(PRESSURE_RETRY_AFTER_SEC));
    }
    next();
}

function normalizeGenerationMode(body) {
    return body?.mode === 'pro' ? 'pro' : 'flash';
}

function checkGenerationPressure(req, res, next) {
    const requestId = req.requestId || 'n/a';
    const mode = normalizeGenerationMode(req.body);

    if (
        mode === 'pro' &&
        (
            activeGenerations >= PRO_PAUSE_ACTIVE_GENERATIONS ||
            queue.length >= PRO_PAUSE_QUEUE_DEPTH
        )
    ) {
        queueLog.warn(ErrorCategory.QUEUE, 'Pro mode temporarily paused due to high load', {
            requestId,
            ip: req.ip,
            mode,
            activeGenerations,
            queueDepth: queue.length,
            proPauseActiveThreshold: PRO_PAUSE_ACTIVE_GENERATIONS,
            proPauseQueueThreshold: PRO_PAUSE_QUEUE_DEPTH
        });
        return res.status(503).json(proTemporarilyPaused(PRESSURE_RETRY_AFTER_SEC));
    }

    if (
        activeGenerations >= MAX_CONCURRENT_GENERATIONS &&
        queue.length >= MAX_QUEUE_DEPTH
    ) {
        queueLog.warn(ErrorCategory.QUEUE, 'Queue full - request rejected', {
            requestId,
            ip: req.ip,
            mode,
            activeGenerations,
            queueDepth: queue.length,
            maxConcurrent: MAX_CONCURRENT_GENERATIONS,
            maxQueueDepth: MAX_QUEUE_DEPTH
        });
        return res.status(429).json(queueFullGeneration(PRESSURE_RETRY_AFTER_SEC));
    }

    next();
}

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

function processQueue() {
    if (activeGenerations < MAX_CONCURRENT_GENERATIONS && queue.length > 0) {
        const { resolve } = queue.shift();
        activeGenerations++;
        queueLog.debug(ErrorCategory.QUEUE, 'Generation dequeued', {
            activeGenerations,
            queueDepth: queue.length
        });
        resolve();
    }
}

// Rate limiting is handled by Upstash Redis (see utils/rate-limiter.js).
// checkRateLimits   → daily limits + cooldown for /generate
// checkFinalizeLimits → window limit for /finalize

if (SHOULD_PRINT_STARTUP_BANNER) {
    log.banner(AEDOS_LOGO, 'cyan');
}

// CORS Configuration
function buildCorsOptions() {
    const env = process.env.NODE_ENV || 'development';
    const rawOrigins = process.env.ALLOWED_ORIGINS || '';

    let allowedOrigins = [];

    if (env === 'production') {
        if (!rawOrigins) {
            throw new Error(
                'ALLOWED_ORIGINS environment variable is required in production.\n' +
                'Example: ALLOWED_ORIGINS=https://aedos.app,https://www.aedos.app'
            );
        }
        allowedOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean);

        // Validate each origin
        for (const origin of allowedOrigins) {
            if (!origin.startsWith('https://') || origin.endsWith('/') || origin.includes('*')) {
                throw new Error(
                    `Invalid origin in ALLOWED_ORIGINS: "${origin}"\n` +
                    'Each origin must start with https://, have no trailing slash, and no wildcards.'
                );
            }
        }
    } else {
        // Development: allow localhost with a warning
        allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:5173',
            'http://127.0.0.1:3000'
        ];
        log.warn(ErrorCategory.CONFIG, 'Using development fallback CORS origins', {
            allowedOrigins
        });
    }

    return {
        origin: (origin, callback) => {
            // Allow server-to-server (no origin header) only in development
            if (!origin) {
                // Allow requests with no origin (healthchecks, server-to-server, curl)
                return callback(null, true);
            }
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            log.warn(ErrorCategory.SECURITY, 'CORS origin rejected', { origin });
            return callback(new Error('Not allowed by CORS'), false);
        },
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false,
        maxAge: 600,
        optionsSuccessStatus: 204
    };
}

app.use(cors(buildCorsOptions()));

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

function shouldTraceRequest(req) {
    const target = req.path || req.originalUrl || '';
    return target === '/' ||
        target.startsWith('/health') ||
        target.startsWith('/generate') ||
        target.startsWith('/finalize') ||
        target.startsWith('/download') ||
        target.startsWith('/__dev__');
}

app.use((req, res, next) => {
    requestSequence += 1;
    const requestId = `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    if (shouldTraceRequest(req)) {
        log.http(ErrorCategory.HTTP, 'Request started', {
            requestId,
            method: req.method,
            path: req.originalUrl,
            ip: req.ip
        });
    }

    res.on('finish', () => {
        if (!shouldTraceRequest(req)) return;
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const payload = {
            requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Number(elapsedMs.toFixed(1)),
            ip: req.ip
        };

        if (res.statusCode >= 500) {
            log.error(ErrorCategory.HTTP, 'Request failed', payload);
            return;
        }
        if (res.statusCode >= 400) {
            log.warn(ErrorCategory.HTTP, 'Request completed with client error', payload);
            return;
        }
        log.http(ErrorCategory.HTTP, 'Request completed', payload);
    });

    next();
});

// Security Headers Middleware
app.use((req, res, next) => {
    // HSTS — only meaningful over HTTPS (Render/proxies set x-forwarded-proto)
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Prevent MIME-type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Control referrer information
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Restrict browser features not used by the app
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // Content Security Policy
    // External resources used: Google Fonts, unpkg (Lucide, Motion, mobile-drag-drop), cdnjs (GSAP)
    // NOTE: 'unsafe-inline' in style-src is required for AI-generated slide HTML loaded via
    // iframe srcdoc — those slides contain extensive inline styles that cannot be pre-hashed.
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' https://unpkg.com https://cdnjs.cloudflare.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
            "font-src 'self' https://fonts.gstatic.com",
            // Generated presentations intentionally use remote image URLs.  The
            // preview iframe must be allowed to load them or the image layout can
            // remain unsettled while the carousel/editor is being initialized.
            "img-src 'self' data: blob: https:",
            "connect-src 'self' https://unpkg.com",
            "frame-src 'self'",
            "worker-src 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'self'"
        ].join('; ')
    );
    next();
});

// Redirect the raw Render URL to the canonical domain BEFORE static files are
// served. express.static intercepts GET / and sends index.html directly,
// bypassing any app.get('/') route handler registered afterwards.
if ((process.env.NODE_ENV || 'development') === 'production') {
    app.use((req, res, next) => {
        const host = req.headers.host || '';
        const path = req.path || '';

        // IMPORTANT: Do NOT redirect API routes or health checks.
        // Vercel proxies these routes to Render, and they must be served directly.
        const isApiRoute = /^\/(generate|finalize(?:-pptx)?|download|health|__dev__)/.test(path);

        if (host.includes('onrender.com') && !isApiRoute) {
            const target = 'https://aedoslab.xyz' + req.originalUrl;
            return res.redirect(301, target);
        }
        next();
    });
}

app.use(express.static(path.join(__dirname, '..', 'frontend'), {
    setHeaders: (res, filePath) => {
        const lowerPath = String(filePath || '').toLowerCase();
        const shouldDisableCache = IS_DEVELOPMENT || lowerPath.endsWith('.html');
        if (!shouldDisableCache) return;

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    }
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

/**
 * Converts an OpenRouter-style fileContext array to Gemini native parts.
 * OpenRouter uses: { type: 'image_url', image_url: { url: 'data:...' } }
 *                  { type: 'file', file_url: { url: 'data:...' } }
 *                  { type: 'text', text: '...' }
 * Gemini native uses: { text: '...' }
 *                     { inlineData: { mimeType, data: base64 } }
 *
 * Supported inlineData mimeTypes by Gemini: image/*, application/pdf
 * DOCX/DOC are pre-converted to plain text by mammoth before reaching here.
 */
function toGeminiParts(promptText, fileContext) {
    const parts = [];

    // Gemini inlineData supports these document MIME types natively
    const GEMINI_SUPPORTED_DOC_MIMES = new Set(['application/pdf']);

    if (Array.isArray(fileContext)) {
        for (const item of fileContext) {
            if (item.type === 'text') {
                parts.push({ text: item.text });
            } else if (item.type === 'image_url' && item.image_url?.url) {
                const dataUrl = item.image_url.url;
                const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                }
            } else if (item.type === 'file' && item.file_url?.url) {
                const dataUrl = item.file_url.url;
                const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    const mimeType = match[1];
                    // Only pass document types that Gemini natively supports as inlineData.
                    // Other document types (e.g. .doc) should have been converted to text by mammoth.
                    if (mimeType.startsWith('image/') || GEMINI_SUPPORTED_DOC_MIMES.has(mimeType)) {
                        parts.push({ inlineData: { mimeType, data: match[2] } });
                    } else {
                        providerLog.warn(ErrorCategory.PROVIDER, 'Skipping unsupported inlineData mime for Gemini', { mimeType });
                    }
                }
            }
        }
    }

    parts.push({ text: promptText });
    return parts;
}

async function* geminiSSEToChunks(response) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) yield text;
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

/**
 * Structured Gemini streaming parser. Yields {type,text} objects.
 * Gemini reasoning is delivered in a separate part with `thought: true` on the
 * underlying part (when thinking is enabled on the model), so we route those
 * to type:'reasoning' and everything else to type:'content'. This lets the
 * chat UI show the model's internal reasoning even when Gemini is the
 * primary provider.
 *
 * Reasoning field shapes handled (per Gemini 2.5+ spec):
 *   - { thought: true, text: '...' }             ← primary
 *   - { thought: '...', text: '...' }            ← older "thoughts" array
 *   - { thoughtSignature, text: '...' }          ← newer signature variant
 *   - parts[].thought_summary / thought_text     ← (defensive)
 */
async function* geminiSSEToStructuredChunks(response) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const parts = parsed.candidates?.[0]?.content?.parts;
                if (!Array.isArray(parts)) continue;
                for (const part of parts) {
                    if (!part || typeof part.text !== 'string' || part.text.length === 0) continue;
                    // `thought: true` marks internal reasoning. Some Gemini
                    // versions put the thought text on `thought` itself
                    // (boolean true or string). Other versions expose it via
                    // `thoughtSummary`. We treat any of these as reasoning.
                    const isReasoning = (
                        part.thought === true ||
                        typeof part.thought === 'string' ||
                        part.thoughtSummary === true ||
                        typeof part.thoughtSummary === 'string' ||
                        part.thoughtSignature != null
                    );
                    if (isReasoning) {
                        yield { type: 'reasoning', text: part.text };
                    } else {
                        yield { type: 'content', text: part.text };
                    }
                }
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

async function callGeminiDirect(prompt, stageName, geminiModel, fileContext = null, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_KEY_MISSING');

    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
    const parts = toGeminiParts(promptText, fileContext);

    const inlineDataCount = parts.filter(p => p.inlineData).length;
    const textCount = parts.filter(p => p.text).length;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

    providerLog.info(ErrorCategory.PROVIDER, 'Trying Gemini direct model', {
        stage: stageName,
        model: geminiModel,
        parts: { text: textCount, inlineData: inlineDataCount }
    });

    // Gemini's thinking/reasoning is enabled by passing a `generationConfig`
    // with `thinkingConfig` (or the older `thinkingBudget`). For the chat UX
    // we ask for a moderate budget so the model produces visible reasoning
    // without runaway cost. The exact field depends on the Gemini model
    // version, so we keep it conservative and let the API reject on bad ones.
    const includeReasoning = options && options.includeReasoning === true;
    const requestBody = { contents: [{ role: 'user', parts }] };
    if (includeReasoning) {
        requestBody.generationConfig = {
            // Allow up to ~4k thinking tokens. This is a soft hint; Gemini
            // may decide to use less. A non-zero value makes the model
            // emit `thought: true` parts that we surface in the UI.
            thinkingConfig: { thinkingBudget: 4096 }
        };
    }

    let response;
    try {
        response = await fetchWithAcceptTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        }, PROVIDER_ACCEPT_TIMEOUT_MS, 'GEMINI_ACCEPT_TIMEOUT');
    } catch (err) {
        if (err?.message === 'GEMINI_ACCEPT_TIMEOUT') {
            providerLog.warn(ErrorCategory.NETWORK, 'Gemini direct accept timeout', {
                stage: stageName,
                model: geminiModel,
                timeoutMs: PROVIDER_ACCEPT_TIMEOUT_MS
            });
        }
        throw err;
    }

    if (!response.ok) {
        const errText = await response.text();
        // Parse error details from Gemini response body for clearer logs
        let errReason = errText;
        try {
            const errJson = JSON.parse(errText);
            errReason = errJson?.error?.message || errText;
        } catch (_) {}
        providerLog.warn(ErrorCategory.PROVIDER, 'Gemini direct request failed — will fall back to OpenRouter', {
            stage: stageName,
            model: geminiModel,
            status: response.status,
            reason: errReason.substring(0, 300)
        });
        throw new Error(`GEMINI_HTTP_${response.status}`);
    }

    providerLog.success(ErrorCategory.PROVIDER, 'Gemini direct accepted request', { stage: stageName, model: geminiModel });
    return {
        stream: includeReasoning
            ? geminiSSEToStructuredChunks(response)
            : geminiSSEToChunks(response),
        provider: 'gemini',
        model: geminiModel
    };
}

// ── OpenRouter fallback (try a list of models sequentially) ───────────────────

/**
 * Streaming SSE parser for OpenRouter. Yields tagged objects so the caller can
 * distinguish reasoning tokens from final content tokens. This matches the
 * OpenAI streaming shape used by OpenRouter in 2026.
 *
 * Reasoning surfaces in several shapes depending on the upstream model:
 *   - `delta.reasoning` (string)               ← OpenRouter-normalized
 *   - `delta.reasoning_content` (string)       ← DeepSeek native
 *   - `delta.reasoning_text` (string)          ← some Anthropic bridges
 *   - `delta.reasoning_details` (array)        ← Anthropic structured
 *   - `delta.thinking` (string)                ← OpenAI o-series
 *   - `delta.thought` (string)                 ← legacy / provider-specific
 *   - `delta.content[].thinking` (parts)       ← some multi-part streams
 * We concatenate any text we find from these locations so the chat UI shows
 * the model's reasoning regardless of which shape the upstream uses.
 *
 * @param {Response} response - fetch response with body already streaming
 * @returns {AsyncGenerator<{type: 'content'|'reasoning', text: string}>}
 */
async function* openRouterStructuredSSE(response) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                if (!delta) continue;

                // 1) Plain string reasoning fields. We check several common
                //    names because the OpenRouter normalization is best-effort
                //    and some upstreams still emit provider-native keys.
                const stringReasoningFields = [
                    'reasoning',         // OpenRouter-normalized (most common)
                    'reasoning_content', // DeepSeek native
                    'reasoning_text',    // Some Anthropic bridges
                    'thinking',          // OpenAI o-series
                    'thought',           // Legacy / provider-specific
                    'reasoning_text_delta', // Defensive
                ];
                for (const field of stringReasoningFields) {
                    const value = delta[field];
                    if (typeof value === 'string' && value.length > 0) {
                        yield { type: 'reasoning', text: value };
                    }
                }

                // 2) Anthropic-style `reasoning_details` array. Each entry
                //    can be {type:'reasoning.text', text:'...'} or carry
                //    the text on a different key depending on the bridge.
                if (Array.isArray(delta.reasoning_details)) {
                    let acc = '';
                    for (const detail of delta.reasoning_details) {
                        if (!detail || typeof detail !== 'object') continue;
                        // Some Anthropic entries are encrypted and carry no
                        // text — skip them rather than emitting empty noise.
                        if (detail.type === 'reasoning.encrypted') continue;
                        if (typeof detail.text === 'string' && detail.text.length > 0) {
                            acc += detail.text;
                        } else if (typeof detail.summary === 'string' && detail.summary.length > 0) {
                            acc += detail.summary;
                        } else if (typeof detail.reasoning === 'string' && detail.reasoning.length > 0) {
                            acc += detail.reasoning;
                        }
                    }
                    if (acc.length > 0) yield { type: 'reasoning', text: acc };
                }

                // 3) Content as a list of {type,text} parts — some providers
                //    emit reasoning on parts with type='reasoning' or
                //    'thinking'. We route those to reasoning and everything
                //    else to content.
                if (Array.isArray(delta.content)) {
                    for (const part of delta.content) {
                        if (typeof part === 'string') {
                            yield { type: 'content', text: part };
                        } else if (part && typeof part.text === 'string' && part.text.length > 0) {
                            if (part.type === 'reasoning' || part.type === 'thinking') {
                                yield { type: 'reasoning', text: part.text };
                            } else {
                                yield { type: 'content', text: part.text };
                            }
                        }
                    }
                } else if (typeof delta.content === 'string' && delta.content.length > 0) {
                    yield { type: 'content', text: delta.content };
                }
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

/**
 * Plain-content streaming SSE parser. Kept for the legacy generation path
 * (Flash + Stage 3 streaming) that only cares about the final text. This
 * avoids forcing every consumer to switch to the structured object format.
 */
async function* openRouterSSEToChunks(response) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.content?.[0];
                if (content) {
                    yield content;
                }
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

async function callOpenRouter(prompt, stageName, openrouterModels, fileContext = null, options = {}) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('QUOTA_EXHAUSTED'); // no key → surface original error

    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    let messagesContent;
    if (fileContext && Array.isArray(fileContext)) {
        messagesContent = [...fileContext, { type: 'text', text: promptText }];
    } else {
        messagesContent = promptText;
    }

    // Allow callers to override the global OPENROUTER_MODEL_LIST by providing
    // an explicit `openrouterModels` array. Fall back to the global list.
    const requestedModels = (Array.isArray(openrouterModels) && openrouterModels.length > 0)
        ? openrouterModels
        : OPENROUTER_MODEL_LIST;

    // Policy guard: Stage3-only OpenRouter models are blocked outside Stage3.
    let modelsToTry = requestedModels;
    if (stageName !== 'Stage3' && OPENROUTER_MODELS_STAGE3_ONLY.length > 0) {
        const stage3OnlySet = new Set(OPENROUTER_MODELS_STAGE3_ONLY);
        modelsToTry = requestedModels.filter((model) => {
            const normalized = String(model || '').trim().toLowerCase();
            return !stage3OnlySet.has(normalized);
        });
    }

    if (!modelsToTry.length) {
        providerLog.warn(ErrorCategory.CONFIG, 'No OpenRouter models available for stage after policy filtering', {
            stage: stageName,
            requestedModels
        });
        throw new Error('OPENROUTER_MODELS_UNAVAILABLE');
    }

    // Resolve the reasoning config. Callers can either:
    //   - pass options.reasoning = { effort: 'low' } explicitly
    //   - pass options.reasoning = 'auto' (default) to use the per-stage default
    //   - pass options.reasoning = null to disable reasoning entirely
    const reasoningConfig = (() => {
        if (options && options.reasoning === null) return null;
        if (options && options.reasoning && typeof options.reasoning === 'object') return options.reasoning;
        return reasoningForStage(stageName);
    })();

    const includeReasoning = options && options.includeReasoning === true;

    // Try each configured OpenRouter model until one responds
    for (const model of modelsToTry) {
        const normalizedModel = model.toLowerCase();
        // Prefer specific OpenRouter providers for models with known best routes.
        const providerOrder = normalizedModel.includes('deepseek')
            ? ['SiliconFlow']
            : (stageName === 'Flash' && normalizedModel.includes('mimo')
                ? ['Xiaomi', 'Parasail']
                : null);
        
        providerLog.info(ErrorCategory.PROVIDER, 'Trying OpenRouter model', {
            stage: stageName,
            model,
            reasoning: reasoningConfig || 'disabled',
            providerOrder: providerOrder || 'default'
        });
        try {
            const body = {
                model,
                messages: [{ role: 'user', content: messagesContent }],
                stream: true
            };
            
            if (providerOrder) {
                // Hint OpenRouter toward the preferred upstreams while keeping
                // fallbacks enabled if those providers are unavailable.
                body.provider = {
                    order: providerOrder,
                    allow_fallbacks: true
                };
            }

            if (reasoningConfig) {
                // OpenRouter accepts {effort} or {max_tokens}; both formats work
                // alongside `enabled: true` (auto-inferred from effort).
                body.reasoning = reasoningConfig;
            }

            const response = await fetchWithAcceptTimeout('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.APP_URL || 'https://aedos.app',
                    'X-Title': 'Aedos'
                },
                body: JSON.stringify(body)
            }, PROVIDER_ACCEPT_TIMEOUT_MS, 'OPENROUTER_ACCEPT_TIMEOUT');

            if (!response.ok) {
                const errText = await response.text();
                providerLog.warn(ErrorCategory.PROVIDER, 'OpenRouter model request failed', {
                    stage: stageName,
                    model,
                    status: response.status,
                    details: errText
                });
                continue;
            }

            providerLog.success(ErrorCategory.PROVIDER, 'OpenRouter model accepted request', {
                stage: stageName,
                model,
                reasoning: reasoningConfig || 'disabled'
            });
            return {
                stream: includeReasoning
                    ? openRouterStructuredSSE(response)
                    : openRouterSSEToChunks(response),
                provider: 'openrouter',
                model
            };
        } catch (err) {
            if (err?.message === 'OPENROUTER_ACCEPT_TIMEOUT') {
                providerLog.warn(ErrorCategory.NETWORK, 'OpenRouter accept timeout', {
                    stage: stageName,
                    model,
                    timeoutMs: PROVIDER_ACCEPT_TIMEOUT_MS
                });
                continue;
            }
            providerLog.warn(classifyError(err, ErrorCategory.NETWORK), 'OpenRouter request error', {
                stage: stageName,
                model,
                error: err
            });
            continue;
        }
    }

    throw new Error('QUOTA_EXHAUSTED');
}

// ── Gemini direct with 503 retry ─────────────────────────────────────────────
const GEMINI_503_MAX_RETRIES = 2;
const GEMINI_503_RETRY_BASE_DELAY_MS = 500;
// How long we wait for the provider to ACCEPT the request (response headers).
// 10s was too aggressive: when Gemini/OpenRouter are busy the reasoning models
// can take >10s just to open the SSE stream, which triggered the avalanche of
// GEMINI_ACCEPT_TIMEOUT → fallback → timeout → QUOTA_EXHAUSTED in production.
// Now configurable via env; 30s default gives providers room to queue without
// letting the request hang forever.
const PROVIDER_ACCEPT_TIMEOUT_MS = runtimeConfig.providerAcceptTimeoutMs;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isGeminiHttpStatus(err, status) {
    if (!err || typeof err.message !== 'string') return false;
    return err.message === `GEMINI_HTTP_${status}`;
}

function isAbortLikeError(err) {
    return err?.name === 'AbortError' || err?.name === 'TimeoutError';
}

async function fetchWithAcceptTimeout(url, options, timeoutMs, timeoutMessage) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } catch (err) {
        if (isAbortLikeError(err)) {
            throw new Error(timeoutMessage);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

function isGeminiRetryableError(err) {
    return isGeminiHttpStatus(err, 503) || err?.message === 'GEMINI_ACCEPT_TIMEOUT';
}

/**
 * Wraps callGeminiDirect with up to 2 retries on HTTP 503 (Service Unavailable)
 * before letting the caller fall back to OpenRouter. Other errors propagate
 * immediately so the fallback is reached sooner.
 */
async function callGeminiDirectWithRetry(prompt, stageName, geminiModel, fileContext = null, options = null) {
    let lastErr;
    for (let attempt = 1; attempt <= GEMINI_503_MAX_RETRIES; attempt++) {
        try {
            return await callGeminiDirect(prompt, stageName, geminiModel, fileContext, options);
        } catch (err) {
            lastErr = err;
            if (!isGeminiRetryableError(err) || attempt === GEMINI_503_MAX_RETRIES) {
                throw err;
            }
            const delay = GEMINI_503_RETRY_BASE_DELAY_MS * attempt;
            providerLog.warn(ErrorCategory.PROVIDER, 'Gemini direct request was retryable, retrying', {
                stage: stageName,
                model: geminiModel,
                attempt,
                maxRetries: GEMINI_503_MAX_RETRIES,
                delayMs: delay,
                error: err.message
            });
            await sleep(delay);
        }
    }
    // Unreachable, but keep TS/linter happy.
    throw lastErr;
}

/**
 * Tries Gemini direct API first; on any error falls back to OpenRouter.
 * The `options` arg is forwarded to both providers so callers can request
 * structured (reasoning-aware) output for the chat UX.
 */
async function callWithFallback(prompt, stageName, geminiModel, openrouterModels, fileContext = null, options = null) {
    if (process.env.NODE_ENV === 'test' && process.env.AEDOS_TEST_STUB_PROVIDERS === '1' && testProviderOverride) {
        return testProviderOverride({ prompt, stageName, geminiModel, openrouterModels, fileContext, options });
    }
    if (process.env.NODE_ENV !== 'production' && process.env.AEDOS_TEST_STUB_PROVIDERS === '1') {
        return createTestProviderResponse(stageName, options);
    }
    if (process.env.GEMINI_API_KEY) {
        try {
            return await callGeminiDirectWithRetry(prompt, stageName, geminiModel, fileContext, options);
        } catch (err) {
            providerLog.warn(ErrorCategory.PROVIDER, 'Gemini direct failed, falling back to OpenRouter', {
                stage: stageName,
                model: geminiModel,
                error: err.message
            });
        }
    }
    // Fallback: OpenRouter
    return await callOpenRouter(prompt, stageName, openrouterModels, fileContext, options);
}

/**
 * Builds a caller that uses Gemini direct as primary and OpenRouter as fallback.
 * Pass `options` (third arg) to enable structured (reasoning-aware) streaming.
 */
function makeCallerFn(stageName, geminiModel, openrouterModels) {
    return async function (prompt, fileContext = null, options = null) {
        return await callWithFallback(prompt, stageName, geminiModel, openrouterModels, fileContext, options);
    };
}

// Stage routing. Two flavours per stage:
//   - `tryModels*`         → plain text streaming (used by Flash / Stage 3
//                            HTML generation paths that only need the final
//                            text, never reasoning).
//   - `tryModels*Thinking` → structured (reasoning + content) streaming, used
//                            by the chat UX (`/generate-skeleton`) to surface
//                            the model's internal thinking in real time.
const tryModelsFlash        = makeCallerFn('Flash',  GEMINI_MODEL_FLASH,  OPENROUTER_MODELS_FLASH);
const tryModelsStage1       = makeCallerFn('Stage1', GEMINI_MODEL_STAGE1, OPENROUTER_MODELS_STAGE1);
const tryModelsStage2       = makeCallerFn('Stage2', GEMINI_MODEL_STAGE2, OPENROUTER_MODELS_STAGE2);
const tryModelsStage3       = makeCallerFn('Stage3', GEMINI_MODEL_STAGE3, OPENROUTER_MODELS_STAGE3);
const tryModelsFlashThinking  = (prompt, fileContext) => tryModelsFlash(prompt, fileContext,  { includeReasoning: true });
const tryModelsStage1Thinking = (prompt, fileContext) => tryModelsStage1(prompt, fileContext, { includeReasoning: true });
const tryModelsStage2Thinking = (prompt, fileContext) => tryModelsStage2(prompt, fileContext, { includeReasoning: true });
const tryModelsStage3Thinking = (prompt, fileContext) => tryModelsStage3(prompt, fileContext, { includeReasoning: true });

// Legacy alias kept for any remaining references
const tryModels = tryModelsFlash;


// Global Puppeteer Browser Instance
let browser;

/**
 * Tentatively finds the Chrome executable in the cache directory.
 * Puppeteer's default resolution can fail on Render's filesystem structure.
 */
function findChromeExecutable(cacheDir) {
    if (!fs.existsSync(cacheDir)) return null;

    /**
     * Guard: ensure the resolved path is an actual file, not a directory.
     * `readdirSync({ recursive: true })` on Linux returns the top-level
     * `chrome-headless-shell` *directory* before the binary inside it, which
     * causes an EACCES error when Puppeteer tries to spawn it as a process.
     */
    function isFile(fullPath) {
        try {
            return fs.statSync(fullPath).isFile();
        } catch (_) {
            return false;
        }
    }

    // Deep search if known paths fail
    try {
        // readdirSync with recursive returns relative paths (POSIX separators on Linux)
        const files = fs.readdirSync(cacheDir, { recursive: true });

        // Priority 1: Find chrome-headless-shell binary (modern Puppeteer preference).
        // On Windows the binary is chrome-headless-shell.exe and on POSIX it has
        // no extension, so match by base name with the optional .exe suffix.
        const shell = files.find(f => {
            const base = path.basename(String(f));
            if (base !== 'chrome-headless-shell' && base !== 'chrome-headless-shell.exe') return false;
            if (String(f).includes('.zip')) return false;
            return isFile(path.join(cacheDir, String(f)));
        });
        if (shell) return path.join(cacheDir, String(shell));

        // Priority 2: Find standard chrome binary (chrome.exe on Windows).
        const chrome = files.find(f => {
            const base = path.basename(String(f));
            if (base !== 'chrome' && base !== 'chrome.exe') return false;
            if (String(f).includes('.zip')) return false;
            if (String(f).includes('chrome-headless-shell')) return false;
            return isFile(path.join(cacheDir, String(f)));
        });
        if (chrome) return path.join(cacheDir, String(chrome));
    } catch (e) {
        return null;
    }
    return null;
}

/**
 * When Render restores `puppeteer-cache` from its disk cache it preserves the
 * directory structure and small files, but silently omits large binaries
 * (~140 MB). The ZIP archive, however, IS kept in the cache. This function
 * detects the missing-binary scenario and extracts directly from the cached
 * ZIP — no network download required.
 *
 * Safe no-op on Windows (dev machines) and when the binary already exists.
 */
function extractChromeFromZip(cacheDir) {
    if (process.platform === 'win32') return;
    if (!fs.existsSync(cacheDir)) return;

    // Only act if the binary is already absent
    if (findChromeExecutable(cacheDir)) return;

    // Look for a chrome-headless-shell ZIP in the cache
    const shellCacheDir = path.join(cacheDir, 'chrome-headless-shell');
    if (!fs.existsSync(shellCacheDir)) return;

    let zipFile;
    try {
        zipFile = fs.readdirSync(shellCacheDir).find(
            f => f.endsWith('.zip') && f.includes('chrome-headless-shell')
        );
    } catch (_) { return; }
    if (!zipFile) return;

    // Derive the expected extract target from the ZIP name:
    // "146.0.7680.76-chrome-headless-shell-linux64.zip" → linux-146.0.7680.76
    const versionMatch = zipFile.match(/^([\d.]+)-chrome-headless-shell-linux64\.zip$/);
    if (!versionMatch) return;

    const version = versionMatch[1];
    const zipPath = path.join(shellCacheDir, zipFile);
    const extractTo = path.join(shellCacheDir, `linux-${version}`);

    puppeteerLog.warn(ErrorCategory.PUPPETEER,
        'Chrome binary missing from cache — extracting from cached ZIP', {
        zip: zipPath,
        extractTo
    }
    );

    try {
        execSync(`unzip -o "${zipPath}" -d "${extractTo}"`, { stdio: 'pipe', timeout: 60000 });
        // Use separate find calls — Render uses /bin/sh (dash), which rejects
        // the bash-only \( ... -o ... \) compound expression.
        execSync(
            `find "${extractTo}" -type f -name 'chrome-headless-shell' -exec chmod +x {} +`,
            { stdio: 'pipe', timeout: 10000 }
        );
        execSync(
            `find "${extractTo}" -type f -name 'chrome' -exec chmod +x {} +`,
            { stdio: 'pipe', timeout: 10000 }
        );
        puppeteerLog.info(ErrorCategory.PUPPETEER, 'Chrome binary extracted and made executable', {
            version,
            path: extractTo
        });
    } catch (err) {
        puppeteerLog.error(ErrorCategory.PUPPETEER, 'Failed to extract Chrome binary from ZIP', {
            error: err.message
        });
    }
}

async function installChrome(cacheDir) {
    // Install into the visible cache dir, using an explicit env map so the
    // command is cross-platform (a bash-style `VAR=value cmd` prefix does not
    // work on Windows cmd.exe).
    puppeteerLog.warn(ErrorCategory.PUPPETEER, 'Chrome binary not found — attempting runtime install', { cacheDir });
    try {
        const { execSync: execSyncInstall } = require('child_process');

        // Remove stale directories so Puppeteer doesn't skip the download.
        // Render restores the cache structure without large binaries, causing
        // the installer to see the directory and assume Chrome is already installed.
        const staleHeadless = path.join(cacheDir, 'chrome-headless-shell');
        const staleChrome = path.join(cacheDir, 'chrome');
        if (fs.existsSync(staleHeadless)) {
            fs.rmSync(staleHeadless, { recursive: true, force: true });
            puppeteerLog.info(ErrorCategory.PUPPETEER, 'Removed stale chrome-headless-shell dir before reinstall');
        }
        if (fs.existsSync(staleChrome)) {
            fs.rmSync(staleChrome, { recursive: true, force: true });
            puppeteerLog.info(ErrorCategory.PUPPETEER, 'Removed stale chrome dir before reinstall');
        }

        execSyncInstall(
            'npx puppeteer browsers install chrome-headless-shell',
            {
                stdio: 'pipe',
                timeout: 5 * 60 * 1000,
                cwd: path.join(__dirname, '..', '..'),
                env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir }
            }
        );
        puppeteerLog.info(ErrorCategory.PUPPETEER, 'Chrome runtime install completed');
    } catch (installErr) {
        puppeteerLog.error(ErrorCategory.PUPPETEER, 'Chrome runtime install failed', { error: installErr.message });
    }
}

async function initBrowser() {
    try {
        const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(__dirname, '..', '..', 'puppeteer-cache');

        // Self-heal: extract from cached ZIP if the binary was dropped by Render's cache
        extractChromeFromZip(cacheDir);

        let autoExecutablePath = findChromeExecutable(cacheDir);

        // Self-heal: if Chrome still not found and no explicit path is set, download it now
        if (!autoExecutablePath && !process.env.PUPPETEER_EXECUTABLE_PATH) {
            await installChrome(cacheDir);
            autoExecutablePath = findChromeExecutable(cacheDir);
        }

        const launchOptions = {
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || autoExecutablePath || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-ipv6',
                '--no-first-run',
                '--no-zygote',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--disable-extensions',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--lang=es-ES,es;q=0.9,en;q=0.8'
            ]
        };

        if (launchOptions.executablePath) {
            puppeteerLog.info(ErrorCategory.PUPPETEER, 'Launching Puppeteer with explicit path', {
                path: launchOptions.executablePath
            });
            // Ensure the binary is executable at runtime — Render can strip the execute
            // bit from downloaded binaries when restoring from cache between deploys.
            try {
                fs.chmodSync(launchOptions.executablePath, 0o755);
                puppeteerLog.info(ErrorCategory.PUPPETEER, 'Chrome binary chmod 755 applied');
            } catch (chmodErr) {
                puppeteerLog.warn(ErrorCategory.PUPPETEER, 'chmod on Chrome binary failed (non-fatal)', {
                    error: chmodErr.message
                });
            }
        }

        browser = await puppeteer.launch(launchOptions);
        puppeteerLog.success(ErrorCategory.PUPPETEER, 'Puppeteer browser initialized');
    } catch (error) {
        // Deep debug of the cache directory if initialization fails
        let cacheDebug = {};
        try {
            const cachePath = process.env.PUPPETEER_CACHE_DIR || path.join(__dirname, '..', '..', 'puppeteer-cache');
            cacheDebug.configuredPath = cachePath;
            if (fs.existsSync(cachePath)) {
                cacheDebug.exists = true;
                cacheDebug.contents = fs.readdirSync(cachePath, { recursive: true }).slice(0, 30);
            } else {
                cacheDebug.exists = false;
                cacheDebug.oldPathExists = fs.existsSync(path.join(__dirname, '..', '..', '.cache', 'puppeteer'));
            }
        } catch (e) {
            cacheDebug.error = e.message;
        }

        puppeteerLog.error(ErrorCategory.PUPPETEER, 'Failed to initialize Puppeteer browser', {
            error,
            cacheDebug,
            envExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH
        });
    }
}
initBrowser();

// Close Puppeteer securely when the server terminates
process.on('SIGINT', async () => {
    log.info(ErrorCategory.BOOT, 'SIGINT received, shutting down gracefully');
    if (browser) {
        await browser.close();
        puppeteerLog.info(ErrorCategory.PUPPETEER, 'Puppeteer browser closed');
    }
    process.exit();
});

// Routes
// Health endpoint for warm-up requests
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/', (req, res) => {
    // Redirect requests hitting the raw onrender.com URL to the canonical domain.
    // We check for 'onrender.com' specifically so that requests arriving via the
    // custom domain (aedoslab.xyz) are served normally and not caught in a
    // redirect loop.
    const host = req.headers.host || '';
    if (process.env.NODE_ENV === 'production' && host.includes('onrender.com')) {
        return res.redirect(301, 'https://aedoslab.xyz');
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

if ((process.env.NODE_ENV || 'development') !== 'production') {
    app.get('/__dev__/last-generated', (req, res) => {
        const debugPath = path.join(TMP_DIR, 'last_generated.html');

        if (!fs.existsSync(debugPath)) {
            return res.status(404).json({ error: 'tmp/last_generated.html not found' });
        }

        res.set('Cache-Control', 'no-store');
        res.type('html');
        res.send(fs.readFileSync(debugPath, 'utf8'));
    });
}



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

app.post('/generate-skeleton', upload.array('files', MAX_UPLOAD_ARRAY_FIELDS), express.json({ limit: '8kb' }), checkGenerationPressure, checkRateLimits, async (req, res) => {
    const requestId = req.requestId || 'n/a';
    let cancelled = false;

    // The 'close' event fires when the underlying connection is closed by EITHER
    // side. When the server ends the response (success or error path) we must NOT
    // mark the request as cancelled — the loop is either already done or about
    // to bail out via the error path.
    res.on('close', () => {
        if (res.writableEnded) return;
        cancelled = true;
    });

    // A crashed/closed browser tab (or a proxy that killed the connection during
    // a long generation) makes the next res.write() emit an 'error' event on the
    // response stream. Without a listener Node throws and restarts the whole
    // process — the "random crash" on Render. Listen, log, and stop the loop.
    res.on('error', (err) => {
        log.warn(ErrorCategory.STREAM, 'Skeleton response stream error, marking request cancelled', {
            requestId,
            error: String((err && err.message) || err)
        });
        cancelled = true;
    });

    try {
        const opciones = req.body;
        const requestedLanguage = req.body.language || req.body.idioma || 'auto';
        
        const rawTema = opciones.tema || '';
        const sanitizeResult = sanitizeTema(String(rawTema));
        if (!sanitizeResult.valid) {
            return res.status(400).json(invalidTopic(sanitizeResult.reason));
        }

        const targetLang = requestedLanguage;
        
        const fileContext = await buildSkeletonFileContext(req.files);
        
        let currentSkeleton = opciones.currentSkeleton;
        if (currentSkeleton && typeof currentSkeleton === 'string') {
            try {
                currentSkeleton = JSON.parse(currentSkeleton);
            } catch (e) {
                // ignore parse errors
            }
        }

        const stage1Prompt = currentSkeleton && typeof currentSkeleton === 'object'
            ? buildStage1RevisionPrompt(sanitizeResult.tema, currentSkeleton, targetLang)
            : buildStage1Prompt(sanitizeResult.tema, targetLang);
        // Skeleton generation uses the same model as Stage 1, with reasoning
        // enabled so the chat UI can stream the model's internal thinking.
        const stage1Response = await tryModelsStage1Thinking(stage1Prompt, fileContext);

        setSseHeaders(res);

        // Emit provider metadata so the client can show "Powered by X" on the
        // thinking panel if it wants. Skipped silently if the model isn't
        // exposed (legacy call shape).
        if (stage1Response && stage1Response.provider && stage1Response.model) {
            try {
                writeSse(res, { metadata: { provider: stage1Response.provider, model: stage1Response.model } });
            } catch (_) {}
        }

        let stage1Raw = '';
        for await (const item of stage1Response.stream) {
            if (cancelled) {
                log.warn(ErrorCategory.STREAM, 'Skeleton generation loop stopped because client disconnected', { requestId });
                break;
            }
            // The stream may be a plain text iterator (legacy callers) or a
            // structured {type,text} iterator (this endpoint). Normalize.
            if (item && typeof item === 'object' && typeof item.text === 'string') {
                if (item.type === 'reasoning') {
                    writeSse(res, { reasoning: item.text });
                } else {
                    stage1Raw += item.text;
                    writeSse(res, { chunk: item.text });
                }
            } else if (typeof item === 'string') {
                stage1Raw += item;
                writeSse(res, { chunk: item });
            }
        }

        if (cancelled) return;

        let contentJson;
        try {
            contentJson = extractJson(stage1Raw);
        } catch (e) {
            res.write(`data: ${JSON.stringify({ error: `Failed to parse AI output as JSON: ${e.message}` })}\n\n`);
            res.end();
            return;
        }

        if (contentJson.rejected) {
            res.write(`data: ${JSON.stringify({ error: 'CONTENT_REJECTED: ' + (contentJson.reason || 'Invalid topic') })}\n\n`);
            res.end();
            return;
        }

        if (contentJson.action === 'proceed') {
            res.write(`data: ${JSON.stringify({ done: true, skeleton: { action: 'proceed' } })}\n\n`);
            res.end();
            return;
        }

        if (!contentJson.slides || !Array.isArray(contentJson.slides) || contentJson.slides.length === 0) {
            writeSse(res, { error: 'STAGE1_INVALID: AI output has no slides array' });
            res.end();
            return;
        }

        const maxSlides = req.body.mode === 'pro' ? MAX_PRO_SLIDES : MAX_FLASH_SLIDES;
        if (contentJson.slides.length > maxSlides) {
            contentJson.slides = contentJson.slides.slice(0, maxSlides);
            contentJson.slide_count = maxSlides;
        }

        writeSse(res, { done: true, skeleton: contentJson });
        res.end();
    } catch (err) {
        log.error(ErrorCategory.PIPELINE, 'Failed to generate skeleton', { requestId, error: err.message });
        if (!res.headersSent) {
            res.status(500).json({ error: ERROR_TEXT.OUTLINE_FAILED });
        } else {
            try {
                writeSse(res, { error: ERROR_TEXT.OUTLINE_FAILED });
                res.end();
            } catch (e) {}
        }
    }
});

app.post('/generate-outline-item', express.json({ limit: '8kb' }), checkGenerationPressure, checkRateLimits, async (req, res) => {
    const requestId = req.requestId || 'n/a';
    try {
        const { type, topic, ...context } = req.body;
        let prompt = '';
        
        if (type === 'slide') {
            prompt = buildAddSlidePrompt(topic, context.existingSlides);
        } else if (type === 'point') {
            prompt = buildAddPointPrompt(topic, context.slideTitle, context.slideSubtitle, context.existingPoints);
        } else {
            return res.status(400).json({ error: ERROR_TEXT.INVALID_ITEM_TYPE });
        }

        // For outline items, we use flash lite to make it fast
        const rawOutputResponse = await tryModelsStage1(prompt, null);
        let rawOutput = '';
        for await (const chunk of rawOutputResponse.stream) {
            rawOutput += chunk;
        }

        let itemJson;
        try {
            itemJson = extractJson(rawOutput);
        } catch (e) {
            throw new Error(`Failed to parse AI output as JSON: ${e.message}`);
        }

        // Validate required fields before returning
        if (!itemJson || typeof itemJson !== 'object') {
            throw new Error('Invalid AI response format for outline item');
        }
        if (!itemJson.title) itemJson.title = '';
        if (!itemJson.role) itemJson.role = 'concept';
        if (!Array.isArray(itemJson.key_points)) itemJson.key_points = [];

        res.json({ item: itemJson });
    } catch (err) {
        log.error(ErrorCategory.PIPELINE, 'Failed to generate outline item', { requestId, error: err.message });
        res.status(500).json({ error: ERROR_TEXT.ITEM_FAILED });
    }
});

app.post('/generate', upload.array('files', MAX_UPLOAD_ARRAY_FIELDS), express.json({ limit: '50kb' }), checkGenerationPressure, checkRateLimits, async (req, res) => {
    let cancelled = false;
    let completed = false;
    let sseKeepAlive = null;
    let hasGenerationSlot = false;
    const requestId = req.requestId || 'n/a';

    // The 'close' event fires when the underlying connection is closed by EITHER
    // side — including when the server itself calls res.end() (e.g. after writing
    // an error message via SSE). Without this guard, an AI failure would log a
    // misleading "Client disconnected" warning even though the client never left.
    res.on('close', () => {
        if (res.writableEnded || completed) return;
        log.warn(ErrorCategory.STREAM, 'Client disconnected before generation completed', {
            requestId
        });
        cancelled = true;
    });

    // Same socket-defence as /generate-skeleton: a disconnected client turns the
    // next res.write() into an 'error' event on the response stream. With no
    // listener the process dies mid-stream and Render restarts the service.
    // Swallow it, log it, and let the 'close' handler / cancelled flag unwind.
    res.on('error', (err) => {
        log.warn(ErrorCategory.STREAM, 'Generation response stream error, marking request cancelled', {
            requestId,
            error: String((err && err.message) || err)
        });
        cancelled = true;
    });

    try {
        const opciones = req.body;
        const requestedLanguage = req.body.language || req.body.idioma || 'auto';
        
        if (opciones.skeleton && typeof opciones.skeleton === 'string') {
            try {
                opciones.skeleton = JSON.parse(opciones.skeleton);
            } catch (e) {
                log.warn(ErrorCategory.VALIDATION, 'Failed to parse skeleton from FormData', { requestId });
            }
        }

        // Bug #15: Validate that the skeleton is not empty before skipping Stage 1
        if (opciones.skeleton && typeof opciones.skeleton === 'object') {
            if (opciones.skeleton.action === 'proceed') {
                return res.status(400).json({ error: ERROR_TEXT.SKELETON_EMPTY });
            }
            const skeletonSlides = opciones.skeleton.slides;
            if (!Array.isArray(skeletonSlides) || skeletonSlides.length === 0) {
                return res.status(400).json({ error: ERROR_TEXT.SKELETON_EMPTY });
            }
        }
        
        log.info(ErrorCategory.PIPELINE, 'Generation request accepted', {
            requestId,
            mode: req.body.mode === 'pro' ? 'pro' : 'flash',
            idioma: requestedLanguage,
            requestedSlides: req.body.slides
        });

        const rawTema = opciones.tema || '';
        const sanitizeResult = sanitizeTema(String(rawTema));
        if (!sanitizeResult.valid) {
            log.warn(ErrorCategory.VALIDATION, 'Topic rejected by sanitizer', {
                requestId,
                reason: sanitizeResult.reason
            });
            return res.status(400).json(invalidTopic(sanitizeResult.reason));
        }

        const targetLang = requestedLanguage;
        opciones.targetLanguage = targetLang;
        opciones.tema = sanitizeResult.tema;

        // Flash mode (single-prompt, default) vs Pro mode (3-stage pipeline)
        const usePipeline = req.body.mode === 'pro';

        let slidesNum = (req.body.slides !== undefined && req.body.slides !== 'undefined') ? parseInt(req.body.slides, 10) : 5;
        if (isNaN(slidesNum) || slidesNum < 1 || slidesNum > 15) {
            log.warn(ErrorCategory.VALIDATION, 'Slides validation failed', {
                requestId,
                slides: req.body.slides
            });
            return res.status(422).json(validationFailed({ slides: 'must be integer between 1 and 15' }));
        }

        // Cap the actual slides requested to the AI based on the mode
        const slideHardLimit = usePipeline ? MAX_PRO_SLIDES : MAX_FLASH_SLIDES;
        if (slidesNum > slideHardLimit) {
            log.warn(ErrorCategory.VALIDATION, 'Slides capped to mode hard limit', {
                requestId,
                requestedSlides: slidesNum,
                appliedLimit: slideHardLimit
            });
            slidesNum = slideHardLimit;
            opciones.slides = slidesNum;
        }

        const VALID_IDIOMAS = ['es', 'en', 'fr', 'pt', 'de'];
        const idiomaVal = req.body.idioma || 'es';
        if (!VALID_IDIOMAS.includes(idiomaVal)) {
            log.warn(ErrorCategory.VALIDATION, 'Language validation failed', {
                requestId,
                idioma: idiomaVal
            });
            return res.status(422).json(validationFailed({ idioma: 'must be one of: es, en, fr, pt, de' }));
        }

        if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY) {
            log.error(ErrorCategory.CONFIG, 'Generation blocked: OpenRouter/Gemini key missing', {
                requestId
            });
            return res.status(500).json({ error: ERROR_TEXT.API_KEY_MISSING });
        }

        setSseHeaders(res);

        // Keep the SSE stream alive during slow model responses so the browser/proxy
        // does not assume the request stalled while OpenRouter is still generating.
        sseKeepAlive = setInterval(() => {
            if (!completed && !cancelled && !res.writableEnded && !res.destroyed) {
                try {
                    res.write(`data: ${JSON.stringify({ heartbeat: true })}\n\n`);
                } catch (_) { /* socket already gone, loop will unwind via cancelled */ }
            }
        }, 25000);

        // Manage Entry to the Queue
        if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
            if (queue.length >= MAX_QUEUE_DEPTH) {
                queueLog.warn(ErrorCategory.QUEUE, 'Queue reached hard cap while request was entering queue', {
                    requestId,
                    activeGenerations,
                    queueDepth: queue.length,
                    maxConcurrent: MAX_CONCURRENT_GENERATIONS,
                    maxQueueDepth: MAX_QUEUE_DEPTH
                });
                writeSse(res, { error: 'QUEUE_FULL', retryAfterSec: PRESSURE_RETRY_AFTER_SEC });
                completed = true;
                res.end();
                return;
            }

            if (
                usePipeline &&
                (
                    activeGenerations >= PRO_PAUSE_ACTIVE_GENERATIONS ||
                    queue.length >= PRO_PAUSE_QUEUE_DEPTH
                )
            ) {
                queueLog.warn(ErrorCategory.QUEUE, 'Pro mode request rejected while entering queue due to pressure', {
                    requestId,
                    activeGenerations,
                    queueDepth: queue.length,
                    proPauseActiveThreshold: PRO_PAUSE_ACTIVE_GENERATIONS,
                    proPauseQueueThreshold: PRO_PAUSE_QUEUE_DEPTH
                });
                writeSse(res, { error: 'PRO_TEMPORARILY_PAUSED', retryAfterSec: PRESSURE_RETRY_AFTER_SEC });
                completed = true;
                res.end();
                return;
            }

            queueLog.warn(ErrorCategory.QUEUE, 'Generation queued due to concurrency limit', {
                requestId,
                activeGenerations,
                queueDepth: queue.length,
                maxConcurrent: MAX_CONCURRENT_GENERATIONS
            });
                    writeSse(res, { queued: true, position: queue.length + 1 });
            const obtainedSlot = await new Promise((resolve) => {
                const item = { resolve: () => resolve(true) };
                queue.push(item);
                req.on('close', () => {
                    const idx = queue.indexOf(item);
                    if (idx !== -1) {
                        queue.splice(idx, 1);
                        queueLog.warn(ErrorCategory.QUEUE, 'Queued request removed because client disconnected', {
                            requestId,
                            queueDepth: queue.length
                        });
                        resolve(false);
                    }
                });
            });
            if (!obtainedSlot) {
                completed = true;
                return;
            }
            hasGenerationSlot = true;
            writeSse(res, { queued: false });
            queueLog.info(ErrorCategory.QUEUE, 'Queued request resumed', {
                requestId,
                activeGenerations,
                queueDepth: queue.length
            });
        } else {
            activeGenerations++;
            hasGenerationSlot = true;
            queueLog.debug(ErrorCategory.QUEUE, 'Generation started without queue wait', {
                requestId,
                activeGenerations,
                queueDepth: queue.length
            });
        }

        // Choose generation path: Flash (single-prompt) or Pro (3-stage pipeline)
        const fileContext = await buildGenerationFileContext(req.files, { requestId, log, ErrorCategory });

        // ── Flash mode retry helper ─────────────────────────────────────────────
        // Flash mode is a single streaming call (no staged pipeline), so the
        // per-stage retry used in Pro mode doesn't apply. Instead we wrap the
        // whole "tryModels + stream + validation" sequence in a retry loop.
        // The underlying callWithFallback already retries 503s and falls back to
        // OpenRouter; this loop specifically targets the post-call failure mode
        // where the model returns 200 OK but the output is unusable (no design
        // CSS, parse error before any CSS was streamed, etc.). CONTENT_REJECTED
        // / explicit refusals are NOT retried because re-prompting the same
        // topic will just get rejected again.
        const FLASH_MAX_RETRIES = 2;
        async function runFlashGenerationWithRetry() {
            let lastError;
            for (let attempt = 1; attempt <= FLASH_MAX_RETRIES + 1; attempt++) {
                if (cancelled) throw new Error('GENERATION_CANCELLED');

                if (attempt > 1) {
                    res.write(`data: ${JSON.stringify({
                        pipeline: true,
                        stage: 'flash',
                        status: 'retrying',
                        attempt: attempt - 1,
                        maxAttempts: FLASH_MAX_RETRIES + 1,
                        error: lastError ? lastError.message : 'AI returned bad output'
                    })}\n\n`);
                    await new Promise(r => setTimeout(r, 500 * (attempt - 1)));
                    if (cancelled) throw new Error('GENERATION_CANCELLED');
                }

                const prompt = buildPrompt(opciones);
                log.info(ErrorCategory.PIPELINE,
                    `Running flash generation path (attempt ${attempt}/${FLASH_MAX_RETRIES + 1})`, {
                    requestId
                });
                // Flash mode streams only the generated HTML/content. Unlike
                // the staged chat flows, we intentionally hide model reasoning
                // here to avoid exposing internal thinking in the UI.
                const flashResult = await tryModelsFlash(prompt, fileContext);

                // Consume the stream into a local buffer. The same cleanup/
                // forwards-to-client logic used by Pro mode applies here; only
                // the retry semantics differ. On the next attempt the iframe
                // will receive a fresh batch of chunks appended to whatever
                // it already had — the final `done` event carries the full
                // HTML so the editor always uses the latest valid output.
                const consumed = await consumeModelStream(
                    flashResult, res, requestId,
                    () => cancelled, slideHardLimit
                );

                const fullHtml = consumed.fullHtml;
                const hasDesignCss = /<style[\s\S]*?section\.s[\s\S]*?<\/style>/i.test(fullHtml)
                    || /<style[\s\S]*?--bg[\s\S]*?<\/style>/i.test(fullHtml);

                if (!hasDesignCss) {
                    lastError = new Error('FLASH_NO_DESIGN_CSS: The AI generated a presentation without design CSS');
                    log.warn(ErrorCategory.PIPELINE,
                        `Flash attempt ${attempt}/${FLASH_MAX_RETRIES + 1}: no design CSS in output`, {
                        requestId,
                        outputChars: fullHtml.length
                    });
                    if (attempt > FLASH_MAX_RETRIES) throw lastError;
                    continue;
                }

                // Success
                return { result: flashResult, fullHtml, hasStartedValidContent: consumed.hasStartedValidContent };
            }
            // Unreachable (loop either returns or throws) but keep linter happy.
            throw lastError;
        }

        // ── Shared stream consumer ──────────────────────────────────────────────
        // Reads chunks from the model stream, strips backticks / <script> /
        // <link> tags, and forwards them to the SSE response. Returns the
        // accumulated raw HTML and a flag indicating whether the document
        // body has started streaming. Throws if the underlying stream errors;
        // parse-error recovery is handled by the caller (the Flash retry
        // wrapper re-runs the generation; the Pro path can recover inline
        // because it always starts from a validated Stage 3 prompt).
        //
        // Supports both legacy text-yielding streams and the structured
        // {type:'content'|'reasoning', text} streams used by the chat UX.
        // Reasoning tokens are forwarded as separate SSE `reasoning` events
        // so the client can show the model's internal thinking in real time.
        async function consumeModelStream(streamResult, res, requestId, cancelledRef, slideHardLimit) {
            let fullHtml = '';
            let hasStartedValidContent = false;
            let streamSlideCount = 0;
            const maxStreamChars = 2_000_000;
            const slideTagRegex = /<section[^>]*\bclass="[^"]*\bs\b[^"]*"[^>]*>/gi;

            function cleanSSEChunk(text) {
                let c = text.replace(/```html\n?/g, '').replace(/```\n?/g, '');
                c = c.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
                c = c.replace(/<script[^>]*>/gi, '');
                c = c.replace(/<script\b[^>]*/gi, '');
                c = c.replace(/<\/script>/gi, '');
                c = c.replace(/<link[^>]*\/?>/gi, '');
                c = c.replace(/<link\b[^>]*/gi, '');
                return c;
            }

            if (streamResult.provider && streamResult.model) {
                res.write(`data: ${JSON.stringify({ metadata: { provider: streamResult.provider, model: streamResult.model } })}\n\n`);
            }

            try {
                for await (const item of streamResult.stream) {
                    if (cancelledRef()) {
                        log.warn(ErrorCategory.STREAM, 'Generation loop stopped because client disconnected', {
                            requestId
                        });
                        break;
                    }
                    // Never write to a dead socket: prevents a pointless 'error'
                    // event burst and lets the loop end gracefully.
                    if (res.writableEnded || res.destroyed) break;

                    // Normalize structured vs. plain-text stream shapes.
                    let chunkText = null;
                    if (item && typeof item === 'object' && typeof item.text === 'string') {
                        if (item.type === 'reasoning') {
                            // Forward reasoning tokens untouched — the client
                            // decides how to display them. We don't accumulate
                            // them into fullHtml because they aren't HTML.
                            try {
                                res.write(`data: ${JSON.stringify({ reasoning: item.text })}\n\n`);
                            } catch (_) { /* ignore broken pipe mid-write */ }
                            continue;
                        }
                        chunkText = item.text;
                    } else if (typeof item === 'string') {
                        chunkText = item;
                    }
                    if (!chunkText) continue;

                    const matches = chunkText.match(slideTagRegex);
                    if (matches) {
                        streamSlideCount += matches.length;
                        if (streamSlideCount > slideHardLimit) {
                            log.warn(ErrorCategory.VALIDATION, 'Stream exceeded slide hard limit, stopping generation', {
                                requestId,
                                streamSlideCount,
                                slideHardLimit
                            });
                            break;
                        }
                    }

                    fullHtml += chunkText;
                    if (fullHtml.length > maxStreamChars) {
                        log.warn(ErrorCategory.VALIDATION, 'Generation stream exceeded HTML size limit', {
                            requestId,
                            maxStreamChars
                        });
                        throw new Error('GENERATION_OUTPUT_TOO_LARGE');
                    }

                    let cleanChunk = cleanSSEChunk(chunkText);

                    if (!hasStartedValidContent) {
                        const matchIdx = fullHtml.indexOf('<!-- CONFIG');
                        const htmlIdx = fullHtml.indexOf('<html');

                        if (matchIdx !== -1) {
                            hasStartedValidContent = true;
                            cleanChunk = cleanSSEChunk(fullHtml.substring(matchIdx));
                            res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
                        } else if (htmlIdx !== -1) {
                            hasStartedValidContent = true;
                            cleanChunk = cleanSSEChunk(fullHtml.substring(htmlIdx));
                            res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
                        } else if (fullHtml.length > 500) {
                            hasStartedValidContent = true;
                            cleanChunk = cleanSSEChunk(fullHtml);
                            res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
                        }
                    } else {
                        res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
                    }
                }
            } catch (streamErr) {
                throw streamErr;
            }

            return { fullHtml, hasStartedValidContent, streamSlideCount };
        }

        let fullHtml = '';
        let hasStartedValidContent = false;

        if (!usePipeline) {
            // Flash mode — single-prompt path with retry on bad output
            const flashOut = await runFlashGenerationWithRetry();
            fullHtml = flashOut.fullHtml;
            hasStartedValidContent = flashOut.hasStartedValidContent;
        } else {
            // Pro mode — 3-Stage Pipeline: Content → Design → HTML
            // (per-stage retries are handled inside runPipeline in pipeline.js;
            // here we only consume the resulting Stage 3 stream and feed it to
            // the same sanitization path as Flash mode).
            log.info(ErrorCategory.PIPELINE, 'Running pro pipeline path', { requestId });
            res.write(`data: ${JSON.stringify({ pipeline: true, stage: 'content', status: 'running' })}\n\n`);

            const pipelineResult = await runPipeline({
                rawInput: opciones.tema,
                targetLanguage: targetLang,
                fileContext: fileContext,
                skeleton: opciones.skeleton,
                maxSlides: slideHardLimit,
                // Use the *Thinking variants so Stages 1 & 2 emit reasoning
                // tokens via onChunk. Stage 3 reuses the same stream shape
                // through consumeModelStream, which also forwards reasoning.
                tryModelsStage1: tryModelsStage1Thinking,
                tryModelsStage2: tryModelsStage2Thinking,
                tryModelsStage3: tryModelsStage3Thinking,
                onStageUpdate: (stage, data) => {
                    if (!cancelled && !res.writableEnded && !res.destroyed) {
                        const stageNames = { stage1: 'content', stage2: 'design', stage3: 'compositing' };
                        try {
                            res.write(`data: ${JSON.stringify({ pipeline: true, stage: stageNames[stage] || stage, ...data })}\n\n`);
                        } catch (_) { /* socket gone */ }
                    }
                },
                onChunk: (item) => {
                    // Forward Stage 1/2 reasoning tokens to the client.
                    // Stage 3 reasoning is forwarded inside consumeModelStream
                    // so we don't double-emit here.
                    if (!cancelled && !res.writableEnded && !res.destroyed && item && item.type === 'reasoning' && item.stage !== 'stage3') {
                        try {
                            res.write(`data: ${JSON.stringify({ reasoning: item.text, stage: item.stage })}\n\n`);
                        } catch (_) { /* ignore broken pipe */ }
                    }
                }
            });

            // Dev debug: persist Stage1/Stage2 outputs and the Stage3 prompt for inspection
            if ((process.env.NODE_ENV || 'development') !== 'production') {
                try {
                    const now = Date.now();
                    const debugBase = path.join(TMP_DIR, `pipeline_debug_${now}`);
                    fs.writeFileSync(debugBase + '_content.json', JSON.stringify(pipelineResult.contentJson, null, 2), 'utf8');
                    fs.writeFileSync(debugBase + '_design.json', JSON.stringify(pipelineResult.designJson, null, 2), 'utf8');
                    if (pipelineResult.stage3Prompt) fs.writeFileSync(debugBase + '_stage3prompt.txt', pipelineResult.stage3Prompt, 'utf8');
                    devLog.success(ErrorCategory.FILESYSTEM, 'Saved pipeline debug artifacts', {
                        requestId,
                        pathPrefix: `${debugBase}_*`
                    });
                } catch (e) {
                    devLog.warn(classifyError(e, ErrorCategory.FILESYSTEM), 'Failed to save pipeline debug artifacts', {
                        requestId,
                        error: e
                    });
                }
            }

            if (cancelled) { res.end(); return; }

            log.info(ErrorCategory.PIPELINE, 'Stage 3 stream ready, starting SSE forwarding', {
                requestId
            });

            const proStream = await consumeModelStream(
                pipelineResult.stage3Stream,
                res, requestId, () => cancelled, slideHardLimit
            );
            fullHtml = proStream.fullHtml;
            hasStartedValidContent = proStream.hasStartedValidContent;
        }

        if (cancelled) {
            res.end();
            return;
        }

        // 6. Clean the full response
        let finalHtml = fullHtml.replace(/^```html\n?/m, '').replace(/^```\n?/m, '').replace(/```\n?$/m, '').trim();

        // 6.5 Remove any existing CSP meta tags to avoid conflicts
        finalHtml = finalHtml.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '');

        // 6.6 Remote image search removed: it was unreachable from Render and the
        //     feature is postponed until a VPS budget exists. img-slot placeholders
        //     keep their gradient fallback.

        // 7. Validate the response — detect refusals
        const configRegex = /<!--\s*CONFIG[\s\S]*?-->/i;
        const configMatch = finalHtml.match(configRegex);
        let contentForCheck = finalHtml.toLowerCase();
        let htmlStartIdx = contentForCheck.indexOf('<html');
        if (htmlStartIdx === -1) htmlStartIdx = contentForCheck.indexOf('<style');
        if (htmlStartIdx === -1) htmlStartIdx = contentForCheck.indexOf('<section');
        if (htmlStartIdx === -1) htmlStartIdx = contentForCheck.indexOf('<!--');

        const looksLikeHtml = htmlStartIdx !== -1;

        let cleanedOutput = finalHtml;
        if (!looksLikeHtml) {
            log.warn(ErrorCategory.VALIDATION, 'Model response was not detected as valid HTML', {
                requestId,
                responseChars: finalHtml.length
            });
            res.write(`data: ${JSON.stringify({ refused: true, message: finalHtml })}\n\n`);
        } else {
            // Trim off any conversational garbage Gemini put *before* the first real HTML tag
            cleanedOutput = finalHtml.substring(finalHtml.indexOf('<', htmlStartIdx));

            // If model output has no <html> wrapper, add a proper document structure
            if (!cleanedOutput.includes('<html') && !cleanedOutput.includes('<head')) {
                cleanedOutput = [
                    '<!DOCTYPE html>',
                    '<html lang="es">',
                    '<head>',
                    '<meta charset="UTF-8">',
                    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
                    '</head>',
                    '<body>',
                    cleanedOutput,
                    '</body>',
                    '</html>'
                ].join('\n');
            }

            // Safety net: hard cap slides (8 for Pro mode, 15 for Flash mode) — strip any section.s beyond the limit
            const MAX_SLIDES = usePipeline ? MAX_PRO_SLIDES : MAX_FLASH_SLIDES;
            const slideTagRe = /<section[^>]*\bclass="[^"]*\bs\b[^"]*"[^>]*>/gi;
            const slideMatches = [...cleanedOutput.matchAll(slideTagRe)];
            if (slideMatches.length > MAX_SLIDES) {
                const cutIndex = slideMatches[MAX_SLIDES].index;
                const bodyClose = cleanedOutput.lastIndexOf('</body>');
                const scripts = bodyClose !== -1 ? cleanedOutput.slice(bodyClose) : '</body></html>';
                cleanedOutput = cleanedOutput.slice(0, cutIndex) + '\n' + scripts;
                sanitizerLog.info(ErrorCategory.SANITIZER, 'Trimmed extra slides in sanitizer', {
                    requestId,
                    beforeSlides: slideMatches.length,
                    maxSlides: MAX_SLIDES
                });
            }

            // Safety net: strip overflow-y:auto/scroll from inner containers.
            // Slides are static — scrollable inner regions produce invisible hidden content.
            // Replace with overflow:hidden so the AI's scale-down rules apply instead.
            const overflowScrollRe = /\boverflow-y\s*:\s*(auto|scroll)\b/gi;
            const overflowShorthandRe = /\boverflow\s*:\s*(auto|scroll)\b/gi;
            if (overflowScrollRe.test(cleanedOutput) || overflowShorthandRe.test(cleanedOutput)) {
                cleanedOutput = cleanedOutput.replace(/\boverflow-y\s*:\s*(auto|scroll)\b/gi, 'overflow-y:hidden');
                cleanedOutput = cleanedOutput.replace(/\boverflow\s*:\s*(auto|scroll)\b/gi, 'overflow:hidden');
                sanitizerLog.info(ErrorCategory.SANITIZER, 'Replaced overflow auto/scroll with hidden');
            }

            // Safety net: fix collapsed flex siblings — a div with a custom class but no inline flex:
            // sizing inside a flex-row collapses to 0px width (text renders one char per line).
            // Detect the pattern: sibling of flex:1;min-width:0 that has only a class and width:100%.
            // We can't fully fix the layout here, but we can add flex:1;min-width:0 to stabilize it.
            cleanedOutput = cleanedOutput.replace(
                /(<div\s+class="[^"]*slide-\d+-[^"]*"\s*>)/gi,
                '<div style="flex:1;min-width:0;overflow:hidden;">'
            );

            // Safety net: fix @import placed as raw text outside <style>
            const looseImportRe = />[ \t\n]*(@import\s+url\([^)]+\);)[ \t\n]*</;
            const looseImport = cleanedOutput.match(looseImportRe);
            if (looseImport) {
                const importLine = looseImport[1];
                cleanedOutput = cleanedOutput.replace(/[ \t\n]*@import\s+url\([^)]+\);[ \t\n]*/gi, '\n');
                cleanedOutput = cleanedOutput.replace(/<style>/i, '<style>\n    ' + importLine);
                sanitizerLog.info(ErrorCategory.SANITIZER, 'Moved loose @import into style block');
            }

            // Guard: reject HTML without design CSS
            const hasDesignCss = /<style[\s\S]*?section\.s[\s\S]*?<\/style>/i.test(cleanedOutput)
                || /<style[\s\S]*?--bg[\s\S]*?<\/style>/i.test(cleanedOutput);
            if (!hasDesignCss) {
                sanitizerLog.warn(ErrorCategory.SANITIZER, 'Rejected output without design CSS', {
                    requestId,
                    outputChars: cleanedOutput.length
                });
                res.write(`data: ${JSON.stringify({ error: 'The AI generated a presentation without CSS design. Please try again.' })}\n\n`);
                res.end();
                return;
            }

            // Server-side HTML sanitization
            cleanedOutput = sanitizeGeneratedHtml(cleanedOutput);
            cleanedOutput = injectLayoutSafetyNet(cleanedOutput);

            const lucideSrc = 'https://unpkg.com/lucide@0.577.0/dist/umd/lucide.min.js';
            const lucideIntegrity = 'sha384-orgVf2eX2+m1zKAOIi09hD0W6GtVhoOUmqDK+sysYB2JTZ4vS86j4jm+X7a4Nnei';
            const hasGoogleFontsReference = /fonts\.googleapis\.com/i.test(cleanedOutput);

            // The editor's font picker injects its own broad font catalog in the live preview.
            // Here on the server, only add the fallback catalog when the generated HTML does
            // not already declare its own Google Fonts, so we preserve the original look.
            const G_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
            const headInjectionParts = [];
            if (!hasGoogleFontsReference) headInjectionParts.push(G_FONTS);
            if (!cleanedOutput.includes(lucideSrc)) {
                headInjectionParts.push(`<script src="${lucideSrc}" integrity="${lucideIntegrity}" crossorigin="anonymous"></script>`);
            }
            const headInjection = headInjectionParts.join('\n');

            if (headInjection) {
                if (cleanedOutput.includes('</head>')) {
                    cleanedOutput = cleanedOutput.replace(/<\/head>/i, `${headInjection}\n</head>`);
                } else if (cleanedOutput.includes('<head>')) {
                    cleanedOutput = cleanedOutput.replace(/<head>/i, `<head>\n${headInjection}`);
                } else {
                    cleanedOutput = `${headInjection}\n` + cleanedOutput;
                }
                sanitizerLog.info(ErrorCategory.SANITIZER, 'Injected sanitizer head dependencies', {
                    requestId,
                    injectedGoogleFonts: !hasGoogleFontsReference,
                    injectedLucide: !cleanedOutput.includes(lucideSrc)
                });
            }

            // 2. Ensure lucide.createIcons() call is present
            if (!cleanedOutput.includes('lucide-init.js') && !cleanedOutput.includes('lucide.createIcons')) {
                const call = '<script src="/features/shared/lucide-init.js"></script>';
                if (cleanedOutput.includes('</body>')) {
                    cleanedOutput = cleanedOutput.replace(/<\/body>/i, `${call}\n</body>`);
                } else {
                    cleanedOutput = cleanedOutput + `\n${call}`;
                }
                sanitizerLog.info(ErrorCategory.SANITIZER, 'Injected lucide-init bootstrap script');
            }

            // 3. Safety Closer: If the AI output ends abruptly (e.g. cut off in mid-comment or mid-tag),
            // force-close them so they don't break the following scripts or icons.
            let safetyCloser = "";
            const openComments = (cleanedOutput.match(/<!--/g) || []).length;
            const closedComments = (cleanedOutput.match(/-->/g) || []).length;
            if (openComments > closedComments) safetyCloser += " -->";

            const openSections = (cleanedOutput.match(/<section/g) || []).length;
            const closedSections = (cleanedOutput.match(/<\/section>/g) || []).length;
            if (openSections > closedSections) safetyCloser += "</section>";

            if (!cleanedOutput.includes('</body>')) safetyCloser += "</body>";
            if (!cleanedOutput.includes('</html>')) safetyCloser += "</html>";

            if (safetyCloser) {
                cleanedOutput += safetyCloser;
                sanitizerLog.info(ErrorCategory.SANITIZER, 'Added safety closers to incomplete HTML', {
                    requestId,
                    closers: safetyCloser
                });
            }

            // 4. Ensure DOCTYPE remains at the start
            if (!cleanedOutput.trim().toLowerCase().startsWith('<!doctype html')) {
                cleanedOutput = '<!DOCTYPE html>\n' + cleanedOutput;
            }

            // 4. Dev-only (NODE_ENV=development): save generated HTML artifacts.
            if (IS_DEVELOPMENT) {
                const debugPath = path.join(TMP_DIR, 'last_generated.html');
                fs.writeFile(debugPath, cleanedOutput, 'utf8', (err) => {
                    if (err) {
                        devLog.warn(classifyError(err, ErrorCategory.FILESYSTEM), 'Failed to save generated debug HTML', {
                            requestId,
                            error: err
                        });
                        return;
                    }
                    devLog.success(ErrorCategory.FILESYSTEM, 'Saved generated debug HTML', {
                        requestId,
                        path: debugPath
                    });
                });

                const titleForFile = extractPresentationTitle(cleanedOutput) || opciones.tema || 'presentation';
                const stem = buildFileStemFromTitle(titleForFile);
                const modeFolder = usePipeline ? 'pro' : 'flash';
                const modeExamplesDir = usePipeline ? EXAMPLES_PRO_DIR : EXAMPLES_FLASH_DIR;
                const examplePath = resolveUniqueHtmlPath(modeExamplesDir, stem);

                fs.writeFile(examplePath, cleanedOutput, 'utf8', (err) => {
                    if (err) {
                        devLog.warn(classifyError(err, ErrorCategory.FILESYSTEM), 'Failed to save generated example HTML', {
                            requestId,
                            error: err,
                            title: titleForFile,
                            mode: modeFolder
                        });
                        return;
                    }

                    devLog.success(ErrorCategory.FILESYSTEM, 'Saved generated example HTML', {
                        requestId,
                        path: examplePath,
                        title: titleForFile,
                        mode: modeFolder
                    });
                });
            }

            res.write(`data: ${JSON.stringify({ done: true, html: cleanedOutput })}\n\n`);
        }

        completed = true;
        res.end();

    } catch (error) {
        const isQuotaError = error.message === 'QUOTA_EXHAUSTED';
        const isPipelineError = error.message && (
            error.message.startsWith('STAGE1_') ||
            error.message.startsWith('STAGE2_') ||
            error.message.startsWith('STAGE_TIMEOUT') ||
            error.message.startsWith('STAGE_EMPTY_OUTPUT') ||
            error.message.startsWith('CONTENT_REJECTED')
        );
        const isFlashNoCss = error.message && error.message.startsWith('FLASH_NO_DESIGN_CSS');
        const isOutputTooLarge = error.message === 'GENERATION_OUTPUT_TOO_LARGE';

        let userMessage;
        if (isQuotaError) {
            userMessage = 'The AI service has reached its usage limit. Please try again in a few minutes.';
            log.warn(ErrorCategory.QUOTA, 'All configured models are quota exhausted', {
                requestId
            });
        } else if (error.message && error.message.startsWith('STAGE_TIMEOUT')) {
            userMessage = 'The AI took too long to respond. Please try again in a moment.';
            log.error(ErrorCategory.PIPELINE, 'Stage timed out', {
                requestId,
                details: error.message
            });
        } else if (error.message && error.message.startsWith('STAGE_EMPTY_OUTPUT')) {
            userMessage = 'The AI returned an empty response. Please try again in a moment.';
            log.error(ErrorCategory.PIPELINE, 'Stage returned empty output', {
                requestId,
                details: error.message
            });
        } else if (isPipelineError) {
            userMessage = 'The AI had trouble understanding the request. Please try rephrasing or adding more detail.';
            log.error(ErrorCategory.PIPELINE, 'Pipeline generation failed', {
                requestId,
                details: error.message
            });
        } else if (isFlashNoCss) {
            // Flash mode's retry loop exhausted (3 attempts × 503-retry + OpenRouter
            // fallback) and every attempt returned HTML without design CSS. The model
            // is up but consistently misformatting — give the user actionable advice.
            userMessage = 'The AI could not produce a valid design after several attempts. Please rephrase your topic with a bit more detail, or switch to Pro mode for better formatting.';
            log.error(ErrorCategory.PIPELINE, 'Flash generation exhausted retries without design CSS', {
                requestId,
                details: error.message
            });
        } else if (isOutputTooLarge) {
            userMessage = 'The generated presentation is too large. Please use fewer slides or a shorter description.';
            log.warn(ErrorCategory.VALIDATION, 'Generation rejected because the streamed HTML exceeded the size limit', {
                requestId
            });
        } else {
            userMessage = 'Something went wrong. Please try again.';
            log.error(classifyError(error, ErrorCategory.UNKNOWN), 'Unhandled generation failure', {
                requestId,
                error
            });
        }

        if (!res.headersSent) {
            res.status(isQuotaError ? 429 : 500).json({ error: userMessage });
            completed = true;
        } else {
            res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
            res.end();
            completed = true;
        }
    } finally {
        if (sseKeepAlive) clearInterval(sseKeepAlive);
        if (hasGenerationSlot) {
            activeGenerations = Math.max(0, activeGenerations - 1);
            queueLog.debug(ErrorCategory.QUEUE, 'Generation slot released', {
                requestId,
                activeGenerations,
                queueDepth: queue.length
            });
            processQueue();
        }
    }
});

// Render the edited slide DOM as an editable PowerPoint. Text remains text
// boxes, images remain image objects, and solid fills/borders become shapes.
function normalizePptxFontFamily(fontFace) {
    return resolveFontFamily(fontFace);
}

// Deterministic, network-free provider used only by contract tests. It is
// activated explicitly by AEDOS_TEST_STUB_PROVIDERS=1 and is never enabled in
// normal development or production.
function createTestProviderResponse(stageName, options = null) {
    const structured = Boolean(options && options.includeReasoning);
    let output;
    if (stageName === 'Stage1') {
        output = structured
            ? JSON.stringify({
                slide_count: 1,
                slides: [{ title: 'Test slide', subtitle: 'Test subtitle', role: 'concept', key_points: ['Test point'] }]
            })
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

async function renderEditablePptx(html, title, requestId, { debug = false } = {}) {
    const exportDpr = Math.min(3, Math.max(1, Number(process.env.EXPORT_DPR) || 2));
    if (!browser || !browser.isConnected()) await initBrowser();
    if (!browser) throw new Error('PowerPoint generation is unavailable: the browser could not be started.');

    const metadataTags = `
        <meta name="author" content="Aedos (aedoslab.xyz)">
        <meta name="generator" content="Aedos (aedoslab.xyz)">
        <meta name="creator" content="Aedos (aedoslab.xyz)">
    `;
    let processedHtml = html.replace(/(<head[^>]*>)/i, `$1\n${metadataTags}`);
    const baseTag = `<base href="http://localhost:${PORT}/">`;
    if (!processedHtml.includes('<base')) processedHtml = processedHtml.replace(/(<head[^>]*>)/i, `$1\n${baseTag}`);

    const page = await browser.newPage();
    try {
        await page.setViewport({ width: SLIDE_W_PX, height: SLIDE_H_PX, deviceScaleFactor: exportDpr });
        await page.setContent(processedHtml, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 12000 }).catch(() => {
            puppeteerLog.warn(ErrorCategory.NETWORK, 'PowerPoint export network idle timeout (non-fatal)', { requestId });
        });
        await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
        await page.addStyleTag({ content: `
            *, *::before, *::after { animation: none !important; transition: none !important; }
            .editor-selection-box, .editor-toolbar, .editor-guide, .editor-color-picker, .img-replace-overlay { display: none !important; }
            body { margin: 0 !important; padding: 0 !important; }
        `});
        const assetWarnings = await page.evaluate(async ({ timeoutMs }) => {
            const warnings = [];
            const withTimeout = (promise, label) => new Promise((resolve) => {
                let settled = false;
                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    warnings.push({ asset: label, reason: `timeout after ${timeoutMs}ms` });
                    resolve(false);
                }, timeoutMs);
                Promise.resolve(promise).then(() => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(true);
                }).catch(() => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    warnings.push({ asset: label, reason: 'load/decode failed' });
                    resolve(false);
                });
            });

            await Promise.all(Array.from(document.images).map(async (img) => {
                const label = img.currentSrc || img.src || '<img>';
                if (img.complete && img.naturalWidth > 0) {
                    await withTimeout(img.decode ? img.decode() : Promise.resolve(), label);
                    return;
                }
                await withTimeout(new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve, { once: true });
                    img.addEventListener('error', reject, { once: true });
                }), label);
                if (img.decode) await withTimeout(img.decode(), label);
            }));

            const urls = new Set();
            const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
            document.querySelectorAll('*').forEach((element) => {
                const background = getComputedStyle(element).backgroundImage || '';
                let match;
                while ((match = urlPattern.exec(background))) {
                    if (match[2]) urls.add(match[2]);
                }
            });
            await Promise.all(Array.from(urls).map((url) => withTimeout(new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = resolve;
                image.onerror = reject;
                image.src = url;
                if (image.complete) resolve();
            }), url)));

            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return warnings;
        }, { timeoutMs: 5000 }).catch((error) => {
            puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint export asset readiness check failed (non-fatal)', {
                requestId,
                error: String(error && error.message || error)
            });
            return [];
        });
        assetWarnings.forEach((warning) => {
            puppeteerLog.warn(ErrorCategory.NETWORK, 'PowerPoint export asset warning (non-fatal)', {
                requestId,
                asset: warning.asset,
                reason: warning.reason,
                warning: normalizeExportWarning({ slide: 0, selector: warning.asset, tipo: 'image-load-failed', motivo: warning.reason, fallback: 'omit failed asset and continue' })
            });
        });

        const slideData = await page.evaluate((textWidthSafety) => {
                const textSelector = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,cite,td,th,span,strong,b,em,i,small,mark,a,div';
                const blockTextTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'BLOCKQUOTE', 'CITE']);
                const slides = Array.from(document.querySelectorAll('section.s, section'));
                return slides.map((slide) => {
                    const slideRect = slide.getBoundingClientRect();
                const exportWarnings = [];
                const warningKeys = new Set();
                const relativeRect = (el) => {
                    const rect = el.getBoundingClientRect();
                    return {
                        x: rect.left - slideRect.left,
                        y: rect.top - slideRect.top,
                        w: rect.width,
                        h: rect.height
                    };
                };
                const effectiveOpacity = (el) => {
                    let opacity = 1;
                    let current = el;
                    while (current && current !== slide.parentElement) {
                        opacity *= Number(getComputedStyle(current).opacity || 1);
                        if (current === slide) break;
                        current = current.parentElement;
                    }
                    return Math.max(0, Math.min(1, opacity));
                };
                const colorWithOpacity = (value, opacity) => {
                    const raw = String(value || '').trim();
                    const rgba = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
                    if (rgba) {
                        const alpha = (rgba[4] === undefined ? 1 : Number(rgba[4])) * opacity;
                        return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
                    }
                    if (opacity >= 0.999) return raw;
                    const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
                    if (hex) {
                        const value = hex[1].length === 3
                            ? hex[1].split('').map(part => part + part).join('')
                            : hex[1].slice(0, 6);
                        const alpha = (hex[1].length === 8 ? parseInt(hex[1].slice(6), 16) / 255 : 1) * opacity;
                        return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
                    }
                    return raw;
                };
                const selectorFor = (el) => {
                    const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
                    return `${el.tagName.toLowerCase()}${classes.map(name => `.${name}`).join('')}`;
                };
                const borderInfoFor = (style) => {
                    const sides = ['Top', 'Right', 'Bottom', 'Left'].map(side => ({
                        width: parseFloat(style[`border${side}Width`]) || 0,
                        color: style[`border${side}Color`] || 'transparent',
                        style: style[`border${side}Style`] || 'none'
                    }));
                    const radiusRaw = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => String(style[`border${corner}Radius`] || '0px').trim());
                    const radiusPx = radiusRaw.map(value => parseFloat(value.split(/\s+/)[0]) || 0);
                    const hasRadius = radiusPx.some(value => value > 0);
                    const borderVisible = sides.some(side => side.width > 0 && side.style !== 'none');
                    const borderUniform = sides.every(side => side.width === sides[0].width && side.color === sides[0].color && side.style === sides[0].style);
                    const radiusUniform = radiusPx.every(value => value === radiusPx[0]) && radiusRaw.every(value => value.split(/\s+/).length === 1);
                    const unsupportedStyle = sides.some(side => ['double', 'groove', 'ridge', 'inset', 'outset'].includes(side.style));
                    return { sides, radiusRaw, radiusPx, hasRadius, borderVisible, borderUniform, radiusUniform, unsupportedStyle, distinct: !borderUniform };
                };
                const splitShadowList = (value) => {
                    const parts = [];
                    let current = '';
                    let depth = 0;
                    for (const character of String(value || '')) {
                        if (character === '(') depth++;
                        if (character === ')') depth--;
                        if (character === ',' && depth === 0) {
                            parts.push(current.trim());
                            current = '';
                        } else current += character;
                    }
                    if (current.trim()) parts.push(current.trim());
                    return parts;
                };
                const warnUnsupportedEffects = (el, style) => {
                    const selector = selectorFor(el);
                    const pushWarning = (tipo, motivo, fallback) => {
                        const key = `${tipo}:${selector}:${motivo}`;
                        if (warningKeys.has(key)) return;
                        warningKeys.add(key);
                        exportWarnings.push({ tipo, selector, motivo, fallback });
                    };
                    const shadows = splitShadowList(style.boxShadow).filter(item => item && item !== 'none');
                    if (shadows.length > 1) pushWarning('shadow-fallback', 'múltiples sombras CSS', 'aplicar sombra dominante alpha×blur');
                    if (shadows.some(item => /\binset\b/i.test(item))) pushWarning('shadow-fallback', 'sombra inset no tiene equivalente outerShdw', 'aplicar sombra dominante como outerShdw');
                    if (shadows.some(item => {
                        const withoutColor = item.replace(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|[a-z]+\b/ig, ' ');
                        const numbers = withoutColor.match(/-?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?/gi) || [];
                        return numbers.length >= 4 && Number.parseFloat(numbers[3]) !== 0 && !(Number.parseFloat(numbers[0]) === 0 && Number.parseFloat(numbers[1]) === 0 && Number.parseFloat(numbers[2] || 0) === 0);
                    })) pushWarning('shadow-fallback', 'spread CSS no tiene equivalente directo en outerShdw', 'aproximar con outerShdw sin spread');
                    if (style.filter !== 'none' && /(drop-shadow|blur)\(/i.test(style.filter)) pushWarning('filter-fallback', 'filter CSS no tiene equivalente editable estable', 'rasterizar el nodo completo a PNG');
                    const border = borderInfoFor(style);
                    if (border.unsupportedStyle) pushWarning('border-fallback', 'border-style complejo no tiene equivalente estable', 'conservar color/ancho y usar prstDash solid');
                    if (border.hasRadius && !border.radiusUniform) pushWarning('radius-approx', 'esquinas elípticas o radios distintos', 'roundRect con radio máximo; se rasteriza si también hay lados distintos');
                    if (border.hasRadius && border.distinct) pushWarning('border-fallback', 'lados distintos combinados con border-radius', 'rasterizar nodo completo');
                    if (border.hasRadius && style.overflow === 'hidden' && el.children.length) pushWarning('radius-approx', 'border-radius con overflow hidden contiene hijos', 'rasterizar nodo completo con clipping redondeado');
                    if (parseFloat(style.outlineOffset) !== 0) pushWarning('border-fallback', 'outline-offset no tiene contorno editable equivalente', 'mapear outline al borde del shape conservando el ancho');
                    if (style.visibility === 'hidden') pushWarning('visibility-fallback', 'visibility:hidden elimina el nodo del render', 'omitir el nodo y conservar warning estructurado');
                    if (style.position === 'fixed' || style.position === 'sticky') pushWarning('position-fallback', `position:${style.position} no conserva anclaje entre HTML y slide`, 'exportar como posición absoluta medida en el viewport');
                };
                const filterOwnerFor = (el) => {
                    let current = el;
                    while (current && current !== slide) {
                        const style = getComputedStyle(current);
                        if (style.filter !== 'none' && /(drop-shadow|blur)\(/i.test(style.filter)) return current;
                        current = current.parentElement;
                    }
                    return null;
                };
                const borderRasterOwnerFor = (el) => {
                    let current = el;
                    while (current && current !== slide) {
                        const style = getComputedStyle(current);
                        const border = borderInfoFor(style);
                        if ((border.hasRadius && border.distinct) || (border.hasRadius && style.overflow === 'hidden' && current.children.length)) return current;
                        current = current.parentElement;
                    }
                    return null;
                };
                const rasterOwnerFor = (el) => filterOwnerFor(el) || borderRasterOwnerFor(el);
                const visible = (el, rect) => {
                    const style = getComputedStyle(el);
                    warnUnsupportedEffects(el, style);
                    const intersectsSlide = rect.x < slideRect.width && rect.y < slideRect.height && rect.x + rect.w > 0 && rect.y + rect.h > 0;
                    if (intersectsSlide && Number(style.opacity || 1) > 0 && Number(style.opacity || 1) < 1 && el.children.length) {
                        const key = `opacity:${el.tagName}:${rect.x}:${rect.y}`;
                        if (!warningKeys.has(key)) {
                            warningKeys.add(key);
                            exportWarnings.push({ tipo: 'opacity-group', selector: el.tagName.toLowerCase(), motivo: 'opacity menor que 1 con hijos', fallback: 'alpha por hijo soportado; imágenes conservan el alpha rasterizado' });
                        }
                    }
                    if (intersectsSlide && style.overflow === 'hidden' && el.children.length) {
                        const clipsChild = Array.from(el.children).some(child => {
                            const childRect = relativeRect(child);
                            return childRect.x < rect.x || childRect.y < rect.y || childRect.x + childRect.w > rect.x + rect.w || childRect.y + childRect.h > rect.y + rect.h;
                        });
                        const key = `overflow:${el.tagName}:${rect.x}:${rect.y}`;
                        if (clipsChild && !warningKeys.has(key)) {
                            warningKeys.add(key);
                            exportWarnings.push({ tipo: 'overflow-clipping', selector: el.tagName.toLowerCase(), motivo: 'overflow hidden recorta un hijo', fallback: 'conservar geometría editable y clipping del slide; no rasterizar grupo' });
                        }
                    }
                    return rect.w > 1 && rect.h > 1 && intersectsSlide && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
                };
                const parseZIndex = (style) => {
                    const value = Number(style.zIndex);
                    return Number.isFinite(value) ? value : 0;
                };
                const createsStackingContext = (el, style) => {
                    if (el === slide) return true;
                    if (style.position !== 'static' && style.zIndex !== 'auto') return true;
                    if (Number(style.opacity || 1) < 1) return true;
                    if (style.transform !== 'none' || style.filter !== 'none' || style.isolation === 'isolate') return true;
                    if (/(transform|opacity|filter|perspective|isolation)/i.test(style.willChange || '')) return true;
                    const parentStyle = el.parentElement ? getComputedStyle(el.parentElement) : null;
                    const parentIsFlexOrGrid = parentStyle && /flex|grid/.test(parentStyle.display || '');
                    return Boolean(parentIsFlexOrGrid && style.zIndex !== 'auto');
                };
                const rootContext = { id: 'ctx-0', parent: null, z: 0, domIndex: 0 };
                const orderByElement = new Map([[slide, { domIndex: 0, context: rootContext }]]);
                const pseudoOrder = [];
                let orderCounter = 1;
                let contextCounter = 1;
                const walkPaintOrder = (el, inheritedContext) => {
                    const style = getComputedStyle(el);
                    const domIndex = orderByElement.has(el) ? orderByElement.get(el).domIndex : orderCounter++;
                    const context = el === slide
                        ? rootContext
                        : createsStackingContext(el, style)
                            ? { id: `ctx-${contextCounter++}`, parent: inheritedContext, z: parseZIndex(style), domIndex }
                            : inheritedContext;
                    orderByElement.set(el, { domIndex, context });
                    if (el !== slide) {
                        const before = getComputedStyle(el, '::before');
                        if (before.content && before.content !== 'none' && before.content !== 'normal') {
                            pseudoOrder.push({ el, pseudo: 'before', domIndex: orderCounter++, context });
                        }
                    }
                    Array.from(el.children).forEach(child => walkPaintOrder(child, context));
                    if (el !== slide) {
                        const after = getComputedStyle(el, '::after');
                        if (after.content && after.content !== 'none' && after.content !== 'normal') {
                            pseudoOrder.push({ el, pseudo: 'after', domIndex: orderCounter++, context });
                        }
                    }
                };
                walkPaintOrder(slide, rootContext);
                const zGroup = (z) => z < 0 ? -1 : z > 0 ? 1 : 0;
                const contextChain = (context) => {
                    const chain = [];
                    let current = context;
                    while (current && current !== rootContext) {
                        chain.unshift(current);
                        current = current.parent;
                    }
                    return chain;
                };
                const orderMeta = (el, phase = 2, part = 0) => {
                    const meta = orderByElement.get(el) || { domIndex: orderCounter++, context: rootContext };
                    const elementCreatesContext = meta.context && meta.context.domIndex === meta.domIndex && el !== slide;
                    const key = contextChain(meta.context).flatMap(context => [zGroup(context.z), context.z, context.domIndex]);
                    if (elementCreatesContext) key.push(zGroup(meta.context.z), meta.context.z, meta.context.domIndex);
                    key.push(phase, meta.domIndex, part);
                    return { domIndex: meta.domIndex, zKey: key, contextId: meta.context?.id || rootContext.id };
                };
                const pseudoMeta = (record) => {
                    const key = contextChain(record.context).flatMap(context => [zGroup(context.z), context.z, context.domIndex]);
                    key.push(record.pseudo === 'before' ? 1 : 3, record.domIndex, 0);
                    return { domIndex: record.domIndex, zKey: key, contextId: record.context?.id || rootContext.id };
                };
                const decodePseudoContent = (value) => {
                    const raw = String(value || '').trim();
                    if (!raw || raw === 'none' || raw === 'normal') return '';
                    if (/^(attr|counter|counters|url)\(/i.test(raw) || /^(open-quote|close-quote|no-open-quote|no-close-quote)$/.test(raw)) return null;
                    const quoted = raw.replace(/^(["'])([\s\S]*)\1$/, '$2');
                    return quoted.replace(/\\([0-9a-f]{1,6})\s?/ig, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(["'\\])/g, '$1');
                };
                const inlinePseudoContent = (el, pseudo) => {
                    if (['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'CANVAS', 'SVG'].includes(el.tagName)) return null;
                    const style = getComputedStyle(el, pseudo);
                    const content = decodePseudoContent(style.content || '');
                    if (content === null || !content || style.display === 'none' || style.position !== 'static') return null;
                    if (style.transform !== 'none' || style.filter !== 'none' || style.backdropFilter !== 'none' || style.maskImage !== 'none' || style.mixBlendMode !== 'normal') return null;
                    return { content, style };
                };
                const candidates = Array.from(slide.querySelectorAll(textSelector)).filter((el) => {
                    if (el.closest('table')) return false;
                    const text = (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
                    if (!text) return false;
                    const rect = relativeRect(el);
                    if (!visible(el, rect)) return false;
                    const descendants = Array.from(el.querySelectorAll(textSelector)).filter((child) => {
                        return (child.innerText || child.textContent || '').replace(/\u00a0/g, ' ').trim();
                    });
                    // Inline styling nodes belong to their nearest semantic
                    // block. Exporting both the parent heading and its accent
                    // span would duplicate and overlap words in PowerPoint.
                    let owner = el.parentElement;
                    while (owner && owner !== slide) {
                        if (blockTextTags.has(owner.tagName) && !(el.tagName === 'LI' && owner.tagName === 'LI')) return false;
                        owner = owner.parentElement;
                    }
                    // Keep complete semantic text blocks. Pro slides commonly
                    // style one word with a nested span/strong and use <br> or
                    // block-level labels inside a paragraph. Selecting only the
                    // deepest node splits long titles and drops direct text that
                    // has no child element.
                    // A semantic block owns that full text; generic wrappers do
                    // not, so they are excluded when they contain descendants.
                    if (blockTextTags.has(el.tagName)) return true;
                    return descendants.length === 0;
                });
                const textItems = candidates.flatMap((el) => {
                    // Pro content cards use a block-level <strong> label
                    // followed by paragraph copy. Export them as two editable
                    // text boxes so PowerPoint preserves both the accent color
                    // and the vertical separation.
                    if (el.tagName === 'P') {
                        const labelEl = Array.from(el.querySelectorAll('strong, b')).find((node) => {
                            return getComputedStyle(node).display === 'block';
                        });
                        if (labelEl) {
                            const labelText = (labelEl.innerText || labelEl.textContent || '').replace(/\u00a0/g, ' ').trim();
                            const fullText = (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
                            const bodyText = fullText.replace(labelText, '').trim();
                            const labelRect = relativeRect(labelEl);
                            const bodyRect = relativeRect(el);
                            bodyRect.y = labelRect.y + labelRect.h + 5;
                            bodyRect.h = Math.max(1, bodyRect.h - labelRect.h - 5);
                            return [
                                { el: labelEl, textOverride: labelText, rectOverride: labelRect },
                                { el, textOverride: bodyText, rectOverride: bodyRect }
                            ].filter(item => item.textOverride);
                        }
                    }
                    return [{ el }];
                });

                const transformText = (text, textTransform) => {
                    if (textTransform === 'uppercase') return text.toUpperCase();
                    if (textTransform === 'lowercase') return text.toLowerCase();
                    if (textTransform === 'capitalize') return text.replace(/(^|\s)(\S)/g, (match, prefix, char) => `${prefix}${char.toUpperCase()}`);
                    return text;
                };
                const extractRuns = (root) => {
                    const runs = [];
                    const visit = (node, inherited = {}) => {
                        if (node.nodeType === Node.TEXT_NODE) {
                            const owner = node.parentElement || root;
                            const style = getComputedStyle(owner);
                            let text = node.nodeValue || '';
                            if (style.whiteSpace !== 'pre' && style.whiteSpace !== 'pre-wrap' && style.whiteSpace !== 'break-spaces') {
                                text = text.replace(/\s+/g, ' ');
                            }
                            text = transformText(text, style.textTransform);
                            if (!text) return;
                            runs.push({
                                text,
                                fontFamily: style.fontFamily,
                                sizePx: parseFloat(style.fontSize) || 12,
                                weight: parseInt(style.fontWeight, 10) || 400,
                                italic: style.fontStyle === 'italic',
                                underline: (style.textDecorationLine || '').includes('underline'),
                                strike: (style.textDecorationLine || '').includes('line-through'),
                                color: colorWithOpacity(style.color, effectiveOpacity(owner)),
                                textShadow: style.textShadow !== 'none' ? style.textShadow : null,
                                letterSpacingPx: Number.isFinite(parseFloat(style.letterSpacing)) ? parseFloat(style.letterSpacing) : 0,
                                baseline: style.verticalAlign === 'sub' ? -25000 : style.verticalAlign === 'super' ? 30000 : (inherited.baseline || 0),
                                href: inherited.href || owner.closest('a[href]')?.href || null
                            });
                            return;
                        }
                        if (node.nodeType !== Node.ELEMENT_NODE) return;
                        if (root.tagName === 'LI' && node !== root && node.tagName === 'LI') return;
                        if (node.tagName === 'BR') {
                            const style = getComputedStyle(node.parentElement || root);
                            runs.push({
                                break: true,
                                sizePx: parseFloat(style.fontSize) || 12,
                                fontFamily: style.fontFamily,
                                color: style.color,
                                textShadow: style.textShadow !== 'none' ? style.textShadow : null,
                                weight: parseInt(style.fontWeight, 10) || 400,
                                italic: style.fontStyle === 'italic'
                            });
                            return;
                        }
                        const style = getComputedStyle(node);
                        if (style.display === 'none' || style.visibility === 'hidden') return;
                        const href = node.closest('a[href]')?.href || inherited.href || null;
                        const baseline = style.verticalAlign === 'sub' ? -25000 : style.verticalAlign === 'super' ? 30000 : (inherited.baseline || 0);
                        node.childNodes.forEach(child => visit(child, { href, baseline }));
                    };
                    visit(root);
                    return runs;
                };
                const sliceRunsToText = (runs, targetText) => {
                    if (!targetText) return runs;
                    const plain = runs.filter(run => !run.break).map(run => run.text).join('');
                    const start = plain.indexOf(targetText);
                    if (start < 0) return runs;
                    const end = start + targetText.length;
                    let cursor = 0;
                    return runs.flatMap((run) => {
                        if (run.break) return [];
                        const runStart = cursor;
                        const runEnd = cursor + run.text.length;
                        cursor = runEnd;
                        const from = Math.max(start, runStart);
                        const to = Math.min(end, runEnd);
                        if (from >= to) return [];
                        return [{ ...run, text: run.text.slice(from - runStart, to - runStart) }];
                    });
                };
                const runsToParagraphs = (runs, style, bullet) => {
                    const align = style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : style.textAlign === 'justify' ? 'justify' : 'left';
                    return [{
                        runs,
                        align,
                        lineHeightPx: style.lineHeight === 'normal' ? null : parseFloat(style.lineHeight) || null,
                        lineHeightNormal: style.lineHeight === 'normal',
                        spaceBeforePx: parseFloat(style.marginTop) || 0,
                        spaceAfterPx: parseFloat(style.marginBottom) || 0,
                        bullet
                    }];
                };
                const tableCellModel = (cell) => {
                    const style = getComputedStyle(cell);
                    const rect = relativeRect(cell);
                    const borderSide = (side) => ({
                        width: parseFloat(style[`border${side}Width`]) || 0,
                        color: colorWithOpacity(style[`border${side}Color`], effectiveOpacity(cell)),
                        style: style[`border${side}Style`] || 'solid'
                    });
                    const runs = extractRuns(cell);
                    return {
                        text: (cell.innerText || cell.textContent || '').replace(/\u00a0/g, ' ').trim(),
                        runs,
                        paragraphs: runsToParagraphs(runs, style, null),
                        fill: colorWithOpacity(style.backgroundColor, effectiveOpacity(cell)),
                        fontSize: parseFloat(style.fontSize) || 16,
                        fontFace: (style.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '').trim(),
                        textColor: colorWithOpacity(style.color, effectiveOpacity(cell)),
                        align: style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : 'left',
                        valign: style.verticalAlign === 'middle' ? 'middle' : style.verticalAlign === 'bottom' ? 'bottom' : 'top',
                        padding: { left: parseFloat(style.paddingLeft) || 0, right: parseFloat(style.paddingRight) || 0, top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 },
                        borders: { left: borderSide('Left'), right: borderSide('Right'), top: borderSide('Top'), bottom: borderSide('Bottom') },
                        colSpan: Math.max(1, Number(cell.colSpan) || 1),
                        rowSpan: Math.max(1, Number(cell.rowSpan) || 1),
                        rect
                    };
                };
                const tables = Array.from(slide.querySelectorAll('table')).map((table) => {
                    const rect = relativeRect(table);
                    const rows = Array.from(table.rows);
                    const firstRow = rows[0];
                    const columns = firstRow ? Array.from(firstRow.cells).flatMap(cell => {
                        const span = Math.max(1, Number(cell.colSpan) || 1);
                        return Array.from({ length: span }, () => relativeRect(cell).w / span);
                    }) : [];
                    return {
                        kind: 'table',
                        ...rect,
                        ...orderMeta(table, 1, 0),
                        name: table.getAttribute('aria-label') || table.caption?.textContent?.trim() || 'HTML table',
                        firstRow: Boolean(table.tHead),
                        columns,
                        rows: rows.map(row => ({
                            height: relativeRect(row).h,
                            cells: Array.from(row.cells).map(cell => tableCellModel(cell))
                        })),
                        z: parseInt(getComputedStyle(table).zIndex, 10) || 2
                    };
                }).filter(table => table.w > 1 && table.h > 1);
                const listInfoFor = (el) => {
                    if (el.tagName !== 'LI') return null;
                    const list = el.closest('ul,ol');
                    if (!list) return null;
                    const style = getComputedStyle(el);
                    const listStyle = style.listStyleType || getComputedStyle(list).listStyleType || 'disc';
                    if (listStyle === 'none') return null;
                    let listDepth = 0;
                    let ancestor = el.parentElement;
                    while (ancestor && ancestor !== slide) {
                        if (ancestor.tagName === 'UL' || ancestor.tagName === 'OL') listDepth++;
                        ancestor = ancestor.parentElement;
                    }
                    const isNumbered = list.tagName === 'OL';
                    const numberStyle = ({
                        decimal: 'arabicPeriod',
                        'lower-alpha': 'alphaLcPeriod',
                        'upper-alpha': 'alphaUcPeriod',
                        'lower-roman': 'romanLcPeriod',
                        'upper-roman': 'romanUcPeriod'
                    })[listStyle] || 'arabicPeriod';
                    const marker = getComputedStyle(el, '::marker');
                    const markerContent = (marker.content || '').replace(/^['"]|['"]$/g, '').trim();
                    const start = Number(list.getAttribute('start')) || 1;
                    const reversed = list.hasAttribute('reversed');
                    const position = Array.from(list.children).filter(child => child.tagName === 'LI').indexOf(el) + 1;
                    return {
                        type: isNumbered ? 'number' : 'char',
                        style: numberStyle,
                        char: markerContent && !/^normal|auto$/i.test(markerContent) ? markerContent : '•',
                        level: Math.max(0, listDepth - 1),
                        marginLeftPx: parseFloat(getComputedStyle(list).paddingLeft) || parseFloat(style.paddingLeft) || 0,
                        startAt: isNumbered
                            ? (reversed ? Math.max(start, list.querySelectorAll(':scope > li').length) - position + 1 : start + position - 1)
                            : null,
                        reversed
                    };
                };

                const texts = textItems.map(({ el, textOverride, rectOverride }) => {
                    const style = getComputedStyle(el);
                    const rect = rectOverride || relativeRect(el);
                    const text = (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
                    const listBullet = listInfoFor(el);
                    const beforePseudo = inlinePseudoContent(el, '::before');
                    const afterPseudo = inlinePseudoContent(el, '::after');
                    const pseudoSpacing = (pixels, sizePx) => {
                        const count = Math.max(1, Math.round((parseFloat(pixels) || 0) / Math.max(1, sizePx * 0.28)));
                        return '\u00a0'.repeat(count);
                    };
                    const pseudoRun = (entry, side) => entry ? {
                        text: side === 'before'
                            ? `${entry.content}${pseudoSpacing(entry.style.marginRight, parseFloat(entry.style.fontSize) || parseFloat(style.fontSize) || 12)}`
                            : `${pseudoSpacing(entry.style.marginLeft, parseFloat(entry.style.fontSize) || parseFloat(style.fontSize) || 12)}${entry.content}`,
                        fontFamily: entry.style.fontFamily,
                        sizePx: parseFloat(entry.style.fontSize) || parseFloat(style.fontSize) || 12,
                        weight: parseInt(entry.style.fontWeight, 10) || 400,
                        italic: entry.style.fontStyle === 'italic',
                        underline: (entry.style.textDecorationLine || '').includes('underline'),
                        strike: (entry.style.textDecorationLine || '').includes('line-through'),
                        color: colorWithOpacity(entry.style.color, effectiveOpacity(el)),
                        textShadow: entry.style.textShadow !== 'none' ? entry.style.textShadow : null,
                        letterSpacingPx: Number.isFinite(parseFloat(entry.style.letterSpacing)) ? parseFloat(entry.style.letterSpacing) : 0,
                        baseline: 0,
                        href: el.closest('a[href]')?.href || null
                    } : null;
                    const resolvedText = `${beforePseudo ? `${beforePseudo.content}${pseudoSpacing(beforePseudo.style.marginRight, parseFloat(beforePseudo.style.fontSize) || parseFloat(style.fontSize) || 12)}` : ''}${(textOverride || text).replace(listBullet ? /^[•◦▪●]\s*/ : /^/, '')}${afterPseudo ? `${pseudoSpacing(afterPseudo.style.marginLeft, parseFloat(afterPseudo.style.fontSize) || parseFloat(style.fontSize) || 12)}${afterPseudo.content}` : ''}`;
                    const runs = [pseudoRun(beforePseudo, 'before'), ...sliceRunsToText(extractRuns(el), textOverride || ''), pseudoRun(afterPseudo, 'after')].filter(Boolean);
                    const isHeading = /^H[1-6]$/.test(el.tagName);
                    if (isHeading) {
                        // Web fonts can be narrower than their Office fallback.
                        // Keep explicit <br> line breaks, but give PowerPoint
                        // enough horizontal room to avoid rewrapping fragments.
                        rect.w = Math.max(rect.w, Math.max(1, slideRect.width - rect.x - 40));
                    }
                    let fontSize = parseFloat(style.fontSize) || 12;
                    if (/^H[2-6]$/.test(el.tagName) && resolvedText.length > 24) {
                        // Long Pro headings should stay on one readable line in
                        // the editable deck instead of overflowing the right
                        // edge or colliding with the subtitle below.
                        const availableWidth = Math.max(120, slideRect.width - rect.x - 40);
                        fontSize = Math.min(fontSize, availableWidth / (resolvedText.length * 0.52));
                    }
                    const before = getComputedStyle(el, '::before');
                    const beforeContent = before.content || '';
                    const beforeWidth = parseFloat(before.width) || 0;
                    const beforeGap = parseFloat(style.columnGap || style.gap) || 0;
                    if (beforeContent && beforeContent !== 'none' && beforeContent !== 'normal' && beforeWidth > 1 && style.display.includes('flex')) {
                        rect.x += beforeWidth + beforeGap;
                        rect.w = Math.max(1, rect.w - beforeWidth - beforeGap);
                    }
                    const lineHeightPx = style.lineHeight === 'normal'
                        ? fontSize * 1.2
                        : (parseFloat(style.lineHeight) || fontSize * 1.2);
                    const normalizedLength = resolvedText.replace(/\s+/g, ' ').trim().length;
                    const estimatedCharsPerLine = Math.max(1, rect.w / Math.max(1, fontSize * 0.52));
                    const estimatedLines = Math.max(1, Math.ceil(normalizedLength / estimatedCharsPerLine));
                    const domLooksSingleLine = style.whiteSpace === 'nowrap' || rect.h <= lineHeightPx * 1.35;
                    if (!domLooksSingleLine) {
                        rect.h = Math.max(rect.h, estimatedLines * lineHeightPx * 1.08);
                    }
                    // Keep the DOM anchor stable while giving PowerPoint a small
                    // metric-safety margin. Center/right aligned boxes expand
                    // around their alignment axis instead of shifting the text.
                    const widthDelta = Math.max(0, rect.w * (textWidthSafety - 1));
                    if (style.textAlign === 'center') {
                        rect.x -= widthDelta / 2;
                        rect.w += widthDelta;
                    } else if (style.textAlign === 'right') {
                        rect.x -= widthDelta;
                        rect.w += widthDelta;
                    } else {
                        rect.w += widthDelta;
                    }
                    return {
                        ...rect,
                        kind: 'text',
                        ...orderMeta(el, 2, 1),
                        selector: `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`,
                        text: resolvedText,
                        runs,
                        paragraphs: runsToParagraphs(runs, style, listBullet),
                        fontSize,
                        fontFace: (style.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '').trim(),
                        textColor: colorWithOpacity(style.color, effectiveOpacity(el)),
                        bold: parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === 'bold',
                        italic: style.fontStyle === 'italic',
                        bullet: listBullet,
                        align: style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : 'left',
                        valign: style.display === 'flex' && style.alignItems === 'center' ? 'middle' : 'top',
                        noWrap: domLooksSingleLine,
                        textShadow: style.textShadow !== 'none' ? style.textShadow : null,
                        filter: style.filter !== 'none' ? style.filter : null,
                        rasterize: Boolean(rasterOwnerFor(el)),
                        shadowOpacity: effectiveOpacity(el),
                        paragraphGap: false,
                        z: parseInt(style.zIndex, 10) || 10
                    };
                });
                const shapes = Array.from(slide.querySelectorAll('*')).filter((el) => {
                    if (el.tagName === 'IMG' || el.tagName === 'SVG' || el === slide || el.closest('table')) return false;
                    const style = getComputedStyle(el);
                    const rect = relativeRect(el);
                    const border = borderInfoFor(style);
                    const hasFill = style.backgroundColor && style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
                    const hasBorder = border.borderVisible || (parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none');
                    const hasShadow = style.boxShadow && style.boxShadow !== 'none';
                    const hasFilter = style.filter !== 'none' && /(drop-shadow|blur)\(/i.test(style.filter);
                    return visible(el, rect) && (hasFill || hasBorder || hasShadow || hasFilter);
                }).map((el) => {
                    const style = getComputedStyle(el);
                    const rect = relativeRect(el);
                    const border = borderInfoFor(style);
                    const outlineWidth = parseFloat(style.outlineWidth) || 0;
                    const useOutline = !border.borderVisible && outlineWidth > 0 && style.outlineStyle !== 'none';
                    return {
                        ...rect,
                        kind: 'shape',
                        ...orderMeta(el, 0, 0),
                        fill: colorWithOpacity(style.backgroundColor, effectiveOpacity(el)),
                        fillOpacity: effectiveOpacity(el),
                        borderColor: colorWithOpacity(useOutline ? style.outlineColor : style.borderTopColor, effectiveOpacity(el)),
                        gradient: style.backgroundImage && style.backgroundImage !== 'none' ? style.backgroundImage : null,
                        borderWidth: useOutline ? outlineWidth : (parseFloat(style.borderTopWidth) || 0),
                        borderStyle: useOutline ? style.outlineStyle : (border.borderUniform ? border.sides[0].style : 'solid'),
                        outlineOffset: parseFloat(style.outlineOffset) || 0,
                        borderRadius: parseFloat(style.borderTopLeftRadius) || 0,
                        shadow: style.boxShadow !== 'none' ? style.boxShadow : null,
                        shadowOpacity: effectiveOpacity(el),
                        filter: style.filter !== 'none' ? style.filter : null,
                        rasterize: Boolean(rasterOwnerFor(el)),
                        widthPx: rect.w,
                        heightPx: rect.h,
                        borderInfo: border,
                        borderSides: border.sides.map(side => ({ ...side, color: colorWithOpacity(side.color, effectiveOpacity(el)) })),
                        borderCompensate: !useOutline && border.borderUniform && border.sides[0].width > 0,
                        borderRadiusPx: parseFloat(style.borderTopLeftRadius) || 0,
                        radiusUniform: borderInfoFor(style).radiusUniform,
                        geometryType: borderInfoFor(style).radiusUniform && borderInfoFor(style).radiusPx[0] >= Math.min(rect.w, rect.h) / 2 && Math.abs(rect.w - rect.h) < 0.5 ? 'ellipse' : (borderInfoFor(style).hasRadius ? 'roundRect' : 'rect'),
                        z: parseInt(style.zIndex, 10) || 0
                    };
                });
                const images = Array.from(slide.querySelectorAll('img')).map((el) => {
                    const rect = relativeRect(el);
                    const style = getComputedStyle(el);
                    const objectFit = style.objectFit || 'fill';
                    const objectPosition = style.objectPosition || '50% 50%';
                    const naturalWidth = el.naturalWidth || 0;
                    const naturalHeight = el.naturalHeight || 0;
                    let crop = null;
                    if (objectFit === 'cover' && naturalWidth > 0 && naturalHeight > 0 && rect.w > 0 && rect.h > 0) {
                        const sourceRatio = naturalWidth / naturalHeight;
                        const boxRatio = rect.w / rect.h;
                        if (sourceRatio > boxRatio) {
                            const visibleRatio = boxRatio / sourceRatio;
                            const position = parseFloat(objectPosition) / 100 || .5;
                            const left = (1 - visibleRatio) * position;
                            crop = { l: left * 100000, r: (1 - left - visibleRatio) * 100000, t: 0, b: 0 };
                        } else if (sourceRatio < boxRatio) {
                            const visibleRatio = sourceRatio / boxRatio;
                            const position = parseFloat(String(objectPosition).split(/\s+/)[1] || objectPosition) / 100 || .5;
                            const top = (1 - visibleRatio) * position;
                            crop = { l: 0, r: 0, t: top * 100000, b: (1 - top - visibleRatio) * 100000 };
                        }
                    }
                    return { ...rect, kind: 'image', ...orderMeta(el, 2, 2), opacity: effectiveOpacity(el), rasterize: Boolean(rasterOwnerFor(el)), objectFit, objectPosition, crop, src: el.currentSrc || el.src || '', naturalWidth, naturalHeight, descr: (el.alt || el.getAttribute('aria-label') || el.getAttribute('role') === 'presentation') ? (el.alt || el.getAttribute('aria-label') || '') : '', visible: visible(el, rect), z: parseInt(style.zIndex, 10) || 5 };
                }).filter(image => image.visible);
                const svgs = Array.from(slide.querySelectorAll('svg')).map((el) => {
                    const rect = relativeRect(el);
                    const style = getComputedStyle(el);
                    return { ...rect, kind: 'image', ...orderMeta(el, 2, 2), opacity: effectiveOpacity(el), rasterize: Boolean(rasterOwnerFor(el)), visible: visible(el, rect), z: parseInt(style.zIndex, 10) || 5 };
                }).filter(svg => svg.visible);
                const canvases = Array.from(slide.querySelectorAll('canvas')).map((el) => {
                    const rect = relativeRect(el);
                    const style = getComputedStyle(el);
                    return { ...rect, kind: 'image', ...orderMeta(el, 2, 2), opacity: effectiveOpacity(el), rasterize: false, src: '', descr: el.getAttribute('aria-label') || '', visible: visible(el, rect), z: parseInt(style.zIndex, 10) || 5 };
                }).filter(canvas => canvas.visible);
                const backgroundElements = Array.from(slide.querySelectorAll('*')).map((el, index) => {
                    if (el.closest('table')) return null;
                    const rect = relativeRect(el);
                    const style = getComputedStyle(el);
                    const gradientColor = (style.backgroundImage || '').match(/(?:rgba?\([^)]*\)|#[0-9a-f]{3,8})/i)?.[0] || style.backgroundColor;
                    return {
                        index,
                        kind: 'shape',
                        ...orderMeta(el, 0, 0),
                        ...rect,
                        backgroundImage: style.backgroundImage,
                        gradientColor,
                        fillOpacity: effectiveOpacity(el),
                        filter: style.filter !== 'none' ? style.filter : null,
                        rasterize: Boolean(rasterOwnerFor(el)),
                        borderInfo: borderInfoFor(style),
                        borderRadiusPx: parseFloat(style.borderTopLeftRadius) || 0,
                        borderRadius: parseFloat(style.borderTopLeftRadius) || 0,
                        visible: visible(el, rect),
                        z: parseInt(style.zIndex, 10) || 1
                    };
                }).filter(item => item && item.visible && item.backgroundImage && item.backgroundImage !== 'none');
                const pseudoDecorations = pseudoOrder.map((record) => {
                    const el = record.el;
                    const parentRect = relativeRect(el);
                    const pseudo = `::${record.pseudo}`;
                    const pseudoIndex = record.pseudo === 'after' ? 1 : 0;
                    {
                        const style = getComputedStyle(el, pseudo);
                        const content = style.content || '';
                        const decodedContent = decodePseudoContent(content);
                        if (decodedContent === null) {
                            exportWarnings.push({ tipo: 'pseudo-fallback', selector: `${selectorFor(el)}${pseudo}`, motivo: `content no editable: ${content}`, fallback: 'omitir pseudo y conservar warning; rasterización aislada no fiable' });
                            return null;
                        }
                        if (inlinePseudoContent(el, pseudo)) return null;
                        if (style.transform !== 'none' || style.filter !== 'none' || style.backdropFilter !== 'none' || style.maskImage !== 'none' || style.mixBlendMode !== 'normal') {
                            exportWarnings.push({ tipo: 'pseudo-fallback', selector: `${selectorFor(el)}${pseudo}`, motivo: 'pseudo con transform/filter/mask/blend no tiene captura aislada estable', fallback: 'omitir pseudo y conservar el contenido editable del padre' });
                            return null;
                        }
                        const width = parseFloat(style.width) || 0;
                        const fontSize = parseFloat(style.fontSize) || 16;
                        const lineHeight = style.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(style.lineHeight) || fontSize * 1.2;
                        const measuredWidth = decodedContent ? Math.max(1, decodedContent.length * fontSize * 0.55) : 0;
                        const height = parseFloat(style.height) || (decodedContent ? lineHeight : 0);
                        const pseudoWidth = width || measuredWidth;
                        const fill = style.backgroundColor && style.backgroundColor !== 'transparent'
                            ? style.backgroundColor
                            : ((style.backgroundImage || '').match(/(?:rgba?\([^)]*\)|#[0-9a-f]{3,8})/i)?.[0] || 'transparent');
                        if (!visible(el, parentRect) || (decodedContent === '' && fill === 'transparent') || pseudoWidth <= 0 || height <= 0) return null;
                        const isText = Boolean(decodedContent);
                        const position = style.position;
                        let positionedAncestor = null;
                        if (position === 'absolute' || position === 'fixed') {
                            let ancestor = el.parentElement;
                            while (ancestor && ancestor !== slide) {
                                if (getComputedStyle(ancestor).position !== 'static') { positionedAncestor = ancestor; break; }
                                ancestor = ancestor.parentElement;
                            }
                            positionedAncestor ||= slide;
                        }
                        const ancestorRect = positionedAncestor ? relativeRect(positionedAncestor) : parentRect;
                        const left = parseFloat(style.left);
                        const top = parseFloat(style.top);
                        const x = positionedAncestor && Number.isFinite(left) ? ancestorRect.x + (parseFloat(getComputedStyle(positionedAncestor).paddingLeft) || 0) + left : parentRect.x + (pseudoIndex === 1 && !isText ? Math.max(0, parentRect.w - pseudoWidth) : 0);
                        const y = positionedAncestor && Number.isFinite(top) ? ancestorRect.y + (parseFloat(getComputedStyle(positionedAncestor).paddingTop) || 0) + top : parentRect.y + (isText ? 0 : Math.max(0, (parentRect.h - height) / 2));
                        return {
                            kind: isText ? 'text' : 'shape',
                            ...pseudoMeta(record),
                            x,
                            y,
                            w: pseudoWidth,
                            h: height,
                            fill: fill === 'transparent' ? 'transparent' : colorWithOpacity(fill, effectiveOpacity(el)),
                            fillOpacity: effectiveOpacity(el),
                            gradient: style.backgroundImage && style.backgroundImage !== 'none' ? style.backgroundImage : null,
                            text: isText ? decodedContent : undefined,
                            textColor: colorWithOpacity(style.color, effectiveOpacity(el)),
                            fontSize,
                            fontFace: (style.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '').trim(),
                            align: style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : 'left',
                            noWrap: true,
                            paragraphs: isText ? [{ text: decodedContent, runs: [{ text: decodedContent, fontFamily: style.fontFamily, sizePx: fontSize, weight: parseInt(style.fontWeight, 10) || 400, italic: style.fontStyle === 'italic', color: colorWithOpacity(style.color, effectiveOpacity(el)), textShadow: style.textShadow !== 'none' ? style.textShadow : null }], align: style.textAlign || 'left', lineHeightPx: lineHeight }] : undefined,
                            shadow: style.boxShadow !== 'none' ? style.boxShadow : null,
                            filter: style.filter !== 'none' ? style.filter : null,
                            rasterize: Boolean(rasterOwnerFor(el)),
                            borderRadius: parseFloat(style.borderTopLeftRadius) || 0,
                            z: parseInt(getComputedStyle(el).zIndex, 10) || 1,
                            name: `${record.pseudo === 'before' ? 'Before' : 'After'} ${selectorFor(el)}`
                        };
                    }
                }).filter(Boolean);
                const filteredElements = Array.from(slide.querySelectorAll('*')).map((el) => {
                    const style = getComputedStyle(el);
                    const rect = relativeRect(el);
                    const owner = rasterOwnerFor(el);
                    if (owner !== el || !visible(el, rect)) return null;
                    const isFilter = style.filter !== 'none' && /(drop-shadow|blur)\(/i.test(style.filter);
                    const border = borderInfoFor(style);
                    const isRadiusFallback = border.hasRadius && (border.distinct || (style.overflow === 'hidden' && el.children.length));
                    if (!isFilter && !isRadiusFallback) return null;
                    return { ...rect, kind: 'image', ...orderMeta(el, 2, 2), opacity: 1, z: parseInt(style.zIndex, 10) || 5, name: `${isFilter ? 'Rasterized filter' : 'Rasterized border'} ${selectorFor(el)}` };
                }).filter(Boolean);
                const style = getComputedStyle(slide);
                return {
                    left: slideRect.left,
                    top: slideRect.top,
                    width: slideRect.width,
                    height: slideRect.height,
                    background: style.backgroundColor,
                    texts,
                    shapes,
                    images,
                    svgs,
                    canvases,
                    backgroundElements,
                    pseudoDecorations,
                    filteredElements,
                    tables,
                    warnings: exportWarnings
                };
            }).filter(slide => slide.width > 10 && slide.height > 10);
        }, TEXT_WIDTH_SAFETY);
        if (!slideData.length) {
            const error = new Error('HTML contract violation: no exportable section.s/section slide was found');
            error.code = 'CONTRACT_VIOLATION';
            throw error;
        }

        const slides = [];
        slideData.forEach((model, slideIndex) => {
            model.warnings = (model.warnings || []).map(warning => normalizeExportWarning(warning, slideIndex + 1));
            model.warnings.forEach((warning) => {
                puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint export fallback decision (non-fatal)', {
                    requestId,
                    warning: { ...warning, slide: slideIndex + 1 }
                });
            });
        });
        for (let slideIndex = 0; slideIndex < slideData.length; slideIndex++) {
            const model = slideData[slideIndex];
            const scaleRect = (item) => ({
                ...item,
                x: pxToEmu(item.x * SLIDE_W_PX / model.width, 'x') + (item.borderCompensate ? pxToEmu((item.borderWidth / 2) * SLIDE_W_PX / model.width, 'x') : 0),
                y: pxToEmu(item.y * SLIDE_H_PX / model.height, 'y') + (item.borderCompensate ? pxToEmu((item.borderWidth / 2) * SLIDE_H_PX / model.height, 'y') : 0),
                w: pxToEmu(item.w * SLIDE_W_PX / model.width, 'x') - (item.borderCompensate ? pxToEmu(item.borderWidth * SLIDE_W_PX / model.width, 'x') : 0),
                h: pxToEmu(item.h * SLIDE_H_PX / model.height, 'y') - (item.borderCompensate ? pxToEmu(item.borderWidth * SLIDE_H_PX / model.height, 'y') : 0)
            });
                const images = [];
                let backgroundImage = null;
                const backgroundClip = await page.evaluate((slideIndex) => {
                    const slide = document.querySelectorAll('section.s, section')[slideIndex];
                    if (!slide) return null;
                    const style = getComputedStyle(slide);
                    if (!style.backgroundImage || style.backgroundImage === 'none') return null;
                    const rect = slide.getBoundingClientRect();
                    const clone = slide.cloneNode(true);
                    slide.setAttribute('data-aedos-background-source-style', slide.getAttribute('style') || '');
                    slide.style.visibility = 'hidden';
                    slide.setAttribute('data-aedos-background-source-hidden', 'true');
                    clone.setAttribute('data-aedos-background-clone', 'true');
                    clone.style.visibility = 'visible';
                    clone.style.position = 'fixed';
                    clone.style.left = `${rect.left}px`;
                    clone.style.top = `${rect.top}px`;
                    clone.style.width = `${rect.width}px`;
                    clone.style.height = `${rect.height}px`;
                    clone.style.margin = '0';
                    // Capture the clone above the document background. A negative
                    // z-index makes the screenshot contain only body/slide paint.
                    clone.style.zIndex = '2147483647';
                    clone.style.pointerEvents = 'none';
                    clone.querySelectorAll('*').forEach((element) => {
                        element.style.visibility = 'hidden';
                    });
                    document.body.appendChild(clone);
                    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                }, slideIndex);
                if (backgroundClip) {
                    const data = await page.screenshot({
                        type: 'png',
                        clip: {
                            x: Math.max(0, backgroundClip.left),
                            y: Math.max(0, backgroundClip.top),
                            width: Math.max(1, backgroundClip.width),
                            height: Math.max(1, backgroundClip.height)
                        },
                        captureBeyondViewport: true
                    });
                    backgroundImage = {
                        x: 0,
                        y: 0,
                        w: SLIDE_WIDTH,
                        h: SLIDE_HEIGHT,
                        data,
                        name: `Slide ${slideIndex + 1} background`
                    };
                    await page.evaluate(() => {
                        document.querySelector('[data-aedos-background-clone]')?.remove();
                        const source = document.querySelector('[data-aedos-background-source-hidden]');
                        if (source) {
                            source.setAttribute('style', source.getAttribute('data-aedos-background-source-style') || '');
                            source.removeAttribute('data-aedos-background-source-style');
                            source.removeAttribute('data-aedos-background-source-hidden');
                        }
                    });
                }
                const backgroundFallbacks = new Set();
                const isNativeGradient = (item) => {
                    if (!item.backgroundImage || item.backgroundImage === 'none' || /url\(/i.test(item.backgroundImage)) return false;
                    return Boolean(parseCssGradient(item.backgroundImage, { width: item.w, height: item.h }));
                };
                const decorativeShapes = [
                    ...model.backgroundElements
                        .filter((item) => {
                            if (item.rasterize) return false;
                            if (/url\(/i.test(item.backgroundImage || '')) return false;
                            const native = isNativeGradient(item);
                            if (!native && item.backgroundImage) backgroundFallbacks.add(item);
                            return native && item.gradientColor;
                        })
                        .map((item) => ({ ...item, fill: item.gradientColor, gradient: item.backgroundImage, borderColor: 'transparent', borderWidth: 0 })),
                    ...model.pseudoDecorations.filter(item => item.kind !== 'text').map((item) => ({ ...item, borderColor: 'transparent', borderWidth: 0 }))
                ];
                const sideBorderShapes = model.shapes.flatMap((shape) => {
                    const border = shape.borderInfo;
                    if (!border || border.borderUniform || border.hasRadius || shape.rasterize || !border.borderVisible) return [];
                    const [top, right, bottom, left] = shape.borderSides || border.sides;
                    const sides = [];
                    const base = { kind: 'shape', borderColor: 'transparent', borderWidth: 0, borderStyle: 'solid', borderRadiusPx: 0, geometryType: 'rect', zKey: shape.zKey, domIndex: shape.domIndex, contextId: shape.contextId };
                    if (top.width > 0) sides.push({ ...base, x: shape.x, y: shape.y, w: shape.w, h: top.width, fill: top.color, name: `${shape.name || 'Shape'} border-top` });
                    if (bottom.width > 0) sides.push({ ...base, x: shape.x, y: shape.y + shape.h - bottom.width, w: shape.w, h: bottom.width, fill: bottom.color, name: `${shape.name || 'Shape'} border-bottom` });
                    const middleY = shape.y + top.width;
                    const middleH = Math.max(0, shape.h - top.width - bottom.width);
                    if (left.width > 0 && middleH > 0) sides.push({ ...base, x: shape.x, y: middleY, w: left.width, h: middleH, fill: left.color, name: `${shape.name || 'Shape'} border-left` });
                    if (right.width > 0 && middleH > 0) sides.push({ ...base, x: shape.x + shape.w - right.width, y: middleY, w: right.width, h: middleH, fill: right.color, name: `${shape.name || 'Shape'} border-right` });
                    return sides;
                });
                for (let backgroundIndex = 0; backgroundIndex < model.backgroundElements.length; backgroundIndex++) {
                    const backgroundElement = model.backgroundElements[backgroundIndex];
                    const shouldRasterize = !backgroundElement.rasterize && (/url\(/i.test(backgroundElement.backgroundImage || '') || backgroundFallbacks.has(backgroundElement));
                    if (!shouldRasterize) continue;
                    const elementClip = await page.evaluate(({ slideIndex: currentSlide, elementIndex }) => {
                        const slide = document.querySelectorAll('section.s, section')[currentSlide];
                        if (!slide) return null;
                        const candidates = Array.from(slide.querySelectorAll('*')).filter((element) => {
                            const style = getComputedStyle(element);
                            return style.backgroundImage && style.backgroundImage !== 'none';
                        });
                        const element = candidates[elementIndex];
                        if (!element) return null;
                        const rect = element.getBoundingClientRect();
                        const clone = element.cloneNode(true);
                        element.setAttribute('data-aedos-background-source-style', element.getAttribute('style') || '');
                        element.style.visibility = 'hidden';
                        element.setAttribute('data-aedos-background-source-hidden', 'true');
                        clone.setAttribute('data-aedos-background-clone', 'true');
                        clone.style.visibility = 'visible';
                        clone.style.position = 'fixed';
                        clone.style.left = `${rect.left}px`;
                        clone.style.top = `${rect.top}px`;
                        clone.style.width = `${rect.width}px`;
                        clone.style.height = `${rect.height}px`;
                        clone.style.margin = '0';
                        // A background-only clone must not carry the element's
                        // direct text node; the text is exported separately as
                        // an editable shape and would otherwise be duplicated.
                        clone.style.color = 'transparent';
                        // Keep unsupported background regions above the page while
                        // their original element is hidden for the clip capture.
                        clone.style.zIndex = '2147483647';
                        clone.style.pointerEvents = 'none';
                        clone.querySelectorAll('*').forEach((child) => {
                            child.style.visibility = 'hidden';
                        });
                        document.body.appendChild(clone);
                        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                    }, { slideIndex, elementIndex: backgroundIndex });
                    if (!elementClip) continue;
                    const data = await page.screenshot({
                        type: 'png',
                        clip: {
                            x: Math.max(0, elementClip.left),
                            y: Math.max(0, elementClip.top),
                            width: Math.max(1, elementClip.width),
                            height: Math.max(1, elementClip.height)
                        },
                        captureBeyondViewport: true
                    });
                    images.push({
                        ...scaleRect(backgroundElement),
                        kind: 'image',
                        data,
                        rasterize: false,
                        z: backgroundElement.z,
                        name: `Slide ${slideIndex + 1} background region ${backgroundIndex + 1}`
                    });
                    if (backgroundFallbacks.has(backgroundElement)) {
                        puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint gradient fallback (non-fatal)', {
                            requestId,
                            warning: {
                                slide: slideIndex + 1,
                                selector: backgroundElement.selector || backgroundElement.name || 'background',
                                tipo: 'gradient-fallback',
                                motivo: 'gradiente CSS no representable como fill nativo',
                                fallback: 'rasterized-region'
                            }
                        });
                    }
                    await page.evaluate(() => {
                        document.querySelector('[data-aedos-background-clone]')?.remove();
                        const source = document.querySelector('[data-aedos-background-source-hidden]');
                        if (source) {
                            source.setAttribute('style', source.getAttribute('data-aedos-background-source-style') || '');
                            source.removeAttribute('data-aedos-background-source-style');
                            source.removeAttribute('data-aedos-background-source-hidden');
                        }
                    });
                }
                for (let imageIndex = 0; imageIndex < model.images.length; imageIndex++) {
                const image = model.images[imageIndex];
                const absolute = {
                    x: Math.max(0, model.left + image.x),
                    y: Math.max(0, model.top + image.y),
                    width: Math.max(1, image.w),
                    height: Math.max(1, image.h)
                };
                // Capture the already-rendered node. Reconstructing a cover image
                // from its source loses object-position and can produce a different
                // crop in Chromium/PowerPoint, so the screenshot is the source of
                // truth for visual fidelity. The native srcRect mapping remains
                // covered by the exporter unit tests for callers that provide it.
                const data = await page.screenshot({ type: 'png', clip: absolute, captureBeyondViewport: true });
                images.push({
                    ...scaleRect(image),
                    crop: null,
                    kind: 'image',
                    data,
                    rasterize: false,
                    name: `Slide ${slideIndex + 1} image ${imageIndex + 1}`
                });
                }
                for (let svgIndex = 0; svgIndex < model.svgs.length; svgIndex++) {
                    const svg = model.svgs[svgIndex];
                    const absolute = {
                        x: Math.max(0, model.left + svg.x),
                        y: Math.max(0, model.top + svg.y),
                        width: Math.max(1, svg.w),
                        height: Math.max(1, svg.h)
                    };
                    const data = await page.screenshot({ type: 'png', clip: absolute, captureBeyondViewport: true });
                    images.push({ ...scaleRect(svg), kind: 'image', data, rasterize: false, name: `Slide ${slideIndex + 1} icon ${svgIndex + 1}` });
                }
                for (let canvasIndex = 0; canvasIndex < (model.canvases || []).length; canvasIndex++) {
                    const canvas = model.canvases[canvasIndex];
                    const absolute = { x: Math.max(0, model.left + canvas.x), y: Math.max(0, model.top + canvas.y), width: Math.max(1, canvas.w), height: Math.max(1, canvas.h) };
                    const data = await page.screenshot({ type: 'png', clip: absolute, captureBeyondViewport: true });
                    images.push({ ...scaleRect(canvas), kind: 'image', data, rasterize: false, descr: canvas.descr || '', name: `Slide ${slideIndex + 1} canvas ${canvasIndex + 1}` });
                }
                for (let filterIndex = 0; filterIndex < (model.filteredElements || []).length; filterIndex++) {
                    const filtered = model.filteredElements[filterIndex];
                    const absolute = {
                        x: Math.max(0, model.left + filtered.x),
                        y: Math.max(0, model.top + filtered.y),
                        width: Math.max(1, filtered.w),
                        height: Math.max(1, filtered.h)
                    };
                    const data = await page.screenshot({ type: 'png', clip: absolute, captureBeyondViewport: true });
                    images.push({ ...scaleRect(filtered), kind: 'image', data, z: filtered.z, name: filtered.name });
                }
            const warnFont = createFontWarningCollector({
                slide: slideIndex + 1,
                onWarning: (warning) => {
                    model.warnings.push(warning);
                    puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint export font substitution (non-fatal)', { requestId, warning });
                }
            });
            const normalizeTextItem = (item) => {
                const normalized = { ...item, fontFace: warnFont(item.fontFace) };
                normalized.name = normalized.name || `Text: ${String(normalized.text || '').replace(/\s+/g, ' ').trim().slice(0, 48)}`;
                normalized.runs = (item.runs || []).map(run => ({ ...run, fontFamily: warnFont(run.fontFamily || item.fontFace) }));
                normalized.paragraphs = (item.paragraphs || []).map(paragraph => ({
                    ...paragraph,
                    runs: (paragraph.runs || []).map(run => ({ ...run, fontFamily: warnFont(run.fontFamily || item.fontFace) }))
                }));
                return normalized;
            };
            const editableShapes = model.shapes.filter(item => !item.rasterize).map((shape) => {
                const distinctBorder = shape.borderInfo && !shape.borderInfo.borderUniform && shape.borderInfo.borderVisible && !shape.borderInfo.hasRadius;
                return distinctBorder ? { ...shape, borderColor: 'transparent', borderWidth: 0, borderCompensate: false } : shape;
            });
            const scaledShapes = [...editableShapes, ...sideBorderShapes, ...decorativeShapes.filter(item => !item.rasterize)].map((shape) => ({
                ...scaleRect(shape),
                name: shape.name || `Shape: ${shape.selector || 'background'}`
            }));
            const scaledTexts = [...model.texts, ...(model.pseudoDecorations || []).filter(item => item.kind === 'text')]
                .filter(item => !item.rasterize)
                .map(item => scaleRect(normalizeTextItem(item)));
            const scaledTables = (model.tables || []).map(table => ({
                ...scaleRect(table),
                columns: (table.columns || []).map(width => pxToEmu(width * SLIDE_W_PX / model.width, 'x')),
                rows: (table.rows || []).map(row => ({
                    ...row,
                    height: pxToEmu(row.height * SLIDE_H_PX / model.height, 'y')
                }))
            }));
            const scaledImages = images.filter(image => !image.rasterize).map(image => ({
                ...image,
                name: image.name || `Image: ${image.alt || 'untitled'}`
            }));
            const gradientWarnings = new Set();
            scaledShapes.forEach((item) => {
                if (!item.gradient || /url\(/i.test(item.gradient)) return;
                if (!parseCssGradient(item.gradient, { width: item.w, height: item.h })) {
                    const key = String(item.gradient);
                    if (gradientWarnings.has(key)) return;
                    gradientWarnings.add(key);
                    // Background elements are rasterized above. This branch is intentionally
                    // limited to pseudo decorations and future shape sources that cannot be
                    // mapped back to a DOM node without risking duplicate rasterization.
                    puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint gradient fallback (non-fatal)', {
                        requestId,
                        warning: {
                            slide: slideIndex + 1,
                            selector: item.selector || item.name || 'shape',
                            tipo: 'gradient-fallback',
                            motivo: 'gradiente CSS no representable como fill nativo',
                            fallback: 'solid-color-for-unsupported-decoration'
                        }
                    });
                }
            });
            const items = [...scaledShapes, ...scaledImages, ...scaledTexts, ...scaledTables]
                .sort(compareZKeys);
            slides.push({
                background: { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT, fill: model.background || '#FFFFFF', borderWidth: 0 },
                backgroundImage,
                items,
                shapes: items.filter(item => item.kind === 'shape'),
                texts: items.filter(item => item.kind === 'text'),
                images: items.filter(item => item.kind === 'image'),
                tables: items.filter(item => item.kind === 'table')
            });
        }
        const pptxBuffer = await createEditablePptx(slides, title || 'Presentation');
        if (debug || process.env.EXPORT_DEBUG === '1') {
            const debugDir = path.join(TMP_DIR, 'export-debug', String(requestId).replace(/[^a-z0-9_-]/gi, '_'));
            fs.mkdirSync(debugDir, { recursive: true });
            fs.writeFileSync(path.join(debugDir, 'input.html'), html, 'utf8');
            fs.writeFileSync(path.join(debugDir, 'slideData.json'), JSON.stringify(slideData, null, 2), 'utf8');
            const allWarnings = [...slideData.flatMap(model => model.warnings || []).map(warning => normalizeExportWarning(warning, warning.slide)), ...assetWarnings.map(warning => normalizeExportWarning({ slide: 0, selector: warning.asset, tipo: 'image-load-failed', motivo: warning.reason, fallback: 'omit failed asset and continue' }))];
            fs.writeFileSync(path.join(debugDir, 'warnings.json'), JSON.stringify({ warnings: allWarnings, counts: countExportWarnings(allWarnings) }, null, 2), 'utf8');
            for (let index = 0; index < slideData.length; index++) {
                const model = slideData[index];
                await page.screenshot({ path: path.join(debugDir, `slide-${index + 1}-dom.png`), clip: { x: Math.max(0, model.left), y: Math.max(0, model.top), width: Math.max(1, model.width), height: Math.max(1, model.height) }, captureBeyondViewport: true });
                const rasterItems = (slides[index]?.images || []).filter(item => item.data);
                rasterItems.forEach((item, rasterIndex) => fs.writeFileSync(path.join(debugDir, `slide-${index + 1}-raster-${rasterIndex + 1}.png`), item.data));
            }
            let offset = 0;
            while (offset + 30 <= pptxBuffer.length) {
                if (pptxBuffer.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; }
                const method = pptxBuffer.readUInt16LE(offset + 8);
                const compressedSize = pptxBuffer.readUInt32LE(offset + 18);
                const nameLength = pptxBuffer.readUInt16LE(offset + 26);
                const extraLength = pptxBuffer.readUInt16LE(offset + 28);
                const name = pptxBuffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
                const start = offset + 30 + nameLength + extraLength;
                const data = pptxBuffer.subarray(start, start + compressedSize);
                if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) fs.writeFileSync(path.join(debugDir, path.basename(name)), method === 8 ? zlib.inflateRawSync(data) : data);
                offset = start + compressedSize;
            }
        }
        const allWarnings = [...slideData.flatMap(model => model.warnings || []).map(warning => normalizeExportWarning(warning, warning.slide)), ...assetWarnings.map(warning => normalizeExportWarning({ slide: 0, selector: warning.asset, tipo: 'image-load-failed', motivo: warning.reason, fallback: 'omit failed asset and continue' }))];
        pptxBuffer.exportWarningCounts = countExportWarnings(allWarnings);
        return pptxBuffer;
    } finally {
        await page.close();
    }
}

app.post('/finalize-pptx', express.json({ limit: '50mb' }), checkFinalizePressure, checkFinalizeLimits, async (req, res) => {
    const requestId = req.requestId || 'n/a';
    res.on('error', (err) => {
        puppeteerLog.warn(ErrorCategory.STREAM, 'PowerPoint response stream error (non-fatal)', {
            requestId,
            error: String((err && err.message) || err)
        });
    });

    if (activeFinalize >= PUPPETEER_MAX_CONCURRENT) {
        const obtainedSlot = await new Promise((resolve) => {
            const item = { resolve: () => resolve(true) };
            finalizeQueue.push(item);
            req.on('close', () => {
                const index = finalizeQueue.indexOf(item);
                if (index !== -1) {
                    finalizeQueue.splice(index, 1);
                    resolve(false);
                }
            });
        });
        if (!obtainedSlot) return;
    } else {
        activeFinalize++;
    }

    try {
        const { html, title } = req.body || {};
        if (!html || typeof html !== 'string') return res.status(400).json({ error: 'HTML content is required' });
        if (html.length > MAX_EXPORT_HTML_BYTES) return res.status(400).json({ error: 'Payload too large' });

        const pptxFilename = `pptx_${crypto.randomBytes(16).toString('hex')}.pptx`;
        const pptxPath = path.join(TMP_DIR, pptxFilename);
        const pptxBuffer = await renderEditablePptx(html, title, requestId, { debug: req.query.debug === '1' });
        fs.writeFileSync(pptxPath, pptxBuffer);

        const safeTitle = title ? title.replace(/[\/\\?%*:|<|>]/g, '-').trim() : 'Presentacion';
        res.set('Cache-Control', 'no-store');
        res.set('X-Export-Warnings', JSON.stringify(pptxBuffer.exportWarningCounts || {}));
        res.json({ pptxUrl: `/download/${pptxFilename}?name=${encodeURIComponent(safeTitle)}` });
        log.success(ErrorCategory.PUPPETEER, 'Editable PowerPoint generated successfully', {
            requestId,
            pptxFilename,
            slideCount: (html.match(/<section\b/gi) || []).length
        });

        setTimeout(() => {
            if (fs.existsSync(pptxPath)) fs.unlink(pptxPath, () => {});
        }, DOWNLOAD_TTL_MS);
    } catch (error) {
        log.error(classifyError(error, ErrorCategory.PUPPETEER), 'Failed to finalize editable PowerPoint', {
            requestId,
            error
        });
        const status = error.code === 'CONTRACT_VIOLATION' ? 400 : 500;
        if (!res.headersSent) res.status(status).json({ error: 'Error generating PowerPoint: ' + (error.message || error), tipo: error.code === 'CONTRACT_VIOLATION' ? 'contract-violation' : undefined });
    } finally {
        activeFinalize--;
        processFinalizeQueue();
    }
});

// Finalize: receive (possibly modified) HTML, convert to PDF
app.post('/finalize', express.json({ limit: '50mb' }), checkFinalizePressure, checkFinalizeLimits, async (req, res) => {
    const requestId = req.requestId || 'n/a';

    // PDF rendering can take tens of seconds; the tab often closes in the
    // meantime. res.json() to a dead socket emits 'error' on the response
    // stream — no listener = process crash. Keep it non-fatal.
    res.on('error', (err) => {
        puppeteerLog.warn(ErrorCategory.STREAM, 'Finalize response stream error (non-fatal)', {
            requestId,
            error: String((err && err.message) || err)
        });
    });

    if (activeFinalize >= PUPPETEER_MAX_CONCURRENT) {
        puppeteerLog.warn(ErrorCategory.QUEUE, 'Puppeteer queued due to concurrency limit', {
            requestId,
            activeFinalize,
            queueDepth: finalizeQueue.length
        });
        const obtainedSlot = await new Promise((resolve) => {
            const item = { resolve: () => resolve(true) };
            finalizeQueue.push(item);
            req.on('close', () => {
                const idx = finalizeQueue.indexOf(item);
                if (idx !== -1) {
                    finalizeQueue.splice(idx, 1);
                    resolve(false);
                }
            });
        });
        if (!obtainedSlot) return; // Client disconnected
    } else {
        activeFinalize++;
    }

    try {
        const { html, title } = req.body;

        log.info(ErrorCategory.PUPPETEER, 'Finalize request accepted', {
            requestId,
            title: title || null
        });

        if (!html || typeof html !== 'string') {
            log.warn(ErrorCategory.VALIDATION, 'Finalize rejected: html missing or invalid type', {
                requestId
            });
            return res.status(400).json({ error: 'HTML content is required' });
        }
        if (html.length > MAX_EXPORT_HTML_BYTES) { // 2MB
            log.warn(ErrorCategory.VALIDATION, 'Finalize rejected: payload too large', {
                requestId,
                htmlBytes: html.length
            });
            return res.status(400).json({ error: 'Payload too large' });
        }

        const pdfFilename = `pdf_${crypto.randomBytes(16).toString('hex')}.pdf`;
        const pdfPath = path.join(TMP_DIR, pdfFilename);

        // Restart / check browser
        if (!browser || !browser.isConnected()) {
            await initBrowser();
        }
        if (!browser) {
            throw new Error('PDF generation is unavailable: the browser could not be started. Please try again shortly.');
        }

        // Replace animated GIFs with a 1×1 transparent placeholder so Puppeteer
        // doesn't time-out or crash while trying to load/decode animation frames.
        const TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        
        // Option B: Inject invisible PDF metadata tags (Author, Generator, Creator)
        // Chromium's print-to-pdf engine automatically reads these and populates the PDF metadata.
        const metadataTags = `
            <meta name="author" content="Aedos (aedoslab.xyz)">
            <meta name="generator" content="Aedos (aedoslab.xyz)">
            <meta name="creator" content="Aedos (aedoslab.xyz)">
        `;
        let processedHtml = html.replace(/(<head[^>]*>)/i, `$1\n${metadataTags}`);

        // Add a <base> tag so root-relative paths like /features/shared/lucide-init.js resolve to this server.
        // Puppeteer uses page.setContent() which has no inherent base URL.
        const baseTag = `<base href="http://localhost:${PORT}/">`;
        if (!processedHtml.includes('<base')) {
            processedHtml = processedHtml.replace(/(<head[^>]*>)/i, `$1\n${baseTag}`);
        }
        // Replace animated GIFs with a 1×1 transparent placeholder
        processedHtml = processedHtml
            // img src pointing to a .gif URL (not already a data-URI)
            .replace(/(<img\b[^>]*?)\bsrc\s*=\s*(["'])(?!data:)[^"']*\.gif[^"']*\2/gi,
                `$1src="${TRANSPARENT_GIF}"`)
            // CSS background-image / content url() pointing to a .gif
            .replace(/url\s*\(\s*(["']?)(?!data:)[^)"'\s]*\.gif[^)"'\s]*\1\s*\)/gi,
                `url("${TRANSPARENT_GIF}")`);

        const page = await browser.newPage();
        try {
            // Step 1: parse the DOM immediately (never hangs on slow/unavailable resources)
            await page.setContent(processedHtml, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Step 2: wait up to 12s for network (CSS @import + .woff2 font files) to settle.
            // Using a separate waitForNetworkIdle with .catch() instead of 'networkidle2' in
            // setContent so it NEVER hangs the request — it gracefully skips on timeout.
            await page.waitForNetworkIdle({ idleTime: 500, timeout: 12000 }).catch(() => {
                puppeteerLog.warn(ErrorCategory.NETWORK, 'Network did not reach idle before timeout', {
                    requestId
                });
            });

            // Step 3: wait for FontFaceSet to confirm fonts are ready after the network settled
            await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {
                puppeteerLog.warn(ErrorCategory.PUPPETEER, 'Font loading check failed (non-fatal)', {
                    requestId
                });
            });
            // Wait for Lucide icons to render
            await page.waitForFunction(() => {
                const pendingIcons = document.querySelectorAll('i[data-lucide]');
                return pendingIcons.length === 0;
            }, { timeout: 8000 }).catch(() => {
                puppeteerLog.warn(ErrorCategory.PUPPETEER, 'Lucide icons may not have fully rendered (timeout)', {
                    requestId
                });
            });
            // Prevent trailing blank page; also lock big-number against wrapping
            // (font metrics in Puppeteer can differ enough to push '30%' to 2 lines)
            await page.addStyleTag({
                content: `
                    @media print {
                        @page { size: 29.7cm 16.7cm; margin: 0; }
                        body, html { 
                            width: 29.7cm !important; 
                            height: auto !important; 
                            margin: 0 !important; 
                            padding: 0 !important; 
                            overflow: visible !important; 
                        }
                        section.s {
                            width: 29.7cm !important;
                            height: 16.7cm !important;
                            page-break-after: always !important;
                            page-break-inside: avoid !important;
                            break-inside: avoid !important;
                            overflow: hidden !important;
                            margin: 0 !important;
                            padding: 0;
                            box-sizing: border-box !important;
                        }
                        section.s:last-of-type { page-break-after: avoid !important; }
                        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                    }
                    body { overflow: hidden; margin: 0; padding: 0; }
                    body > script { display: none; }
                    .big-number { white-space: nowrap !important; overflow: visible !important; text-overflow: clip !important; word-break: normal !important; overflow-wrap: normal !important; }
                `
            });

            // Step 5: Puppeteer-side layout normalization.
            // Runs AFTER fonts are loaded, using Puppeteer's own metrics — immune to
            // browser-vs-Puppeteer font-metric drift.
            // - Locks every text element's font-size/line-height to computed px values
            //   (eliminates cqi / rem / min() re-computation during PDF render).
            // - Applies white-space:nowrap to elements that render as a single line
            //   in Puppeteer, so they cannot reflow during the print pass.
            await page.evaluate(() => {
                const CONTAINERS = [
                    '[data-container="true"]',
                    'div.stat-box', 'div.card', 'div.step-item', 'div.timeline-item',
                    '.stat-grid', '.grid-2', '.grid-3', '.flex-col', '.flex-row',
                    '.quote-block', 'blockquote', 'ul', 'ol',
                    '[class*="card"]', '[class*="box"]'
                ].join(',');
                const TEXT = 'h1,h2,h3,h4,p,span,blockquote,li,cite,.big-number,.big-label,.tag,.subtitle,.step-num,.timeline-year';
                document.querySelectorAll(CONTAINERS).forEach(container => {
                    container.querySelectorAll(TEXT).forEach(el => {
                        const comp = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        if (!rect.width || !rect.height) return;
                        // Lock font-size and line-height to absolute px (removes cqi/rem/min())
                        el.style.setProperty('font-size', comp.fontSize, 'important');
                        el.style.setProperty('line-height', comp.lineHeight, 'important');
                        // If it renders as a single line in Puppeteer, prevent wrapping
                        const lh = parseFloat(comp.lineHeight) || parseFloat(comp.fontSize) * 1.2;
                        if (rect.height <= lh * 1.8) {
                            el.style.setProperty('white-space', 'nowrap', 'important');
                            el.style.setProperty('word-break', 'normal', 'important');
                            el.style.setProperty('overflow-wrap', 'normal', 'important');
                        }
                    });
                });
            }).catch(() => {
                puppeteerLog.warn(ErrorCategory.PUPPETEER, 'Puppeteer layout normalization failed (non-fatal)', {
                    requestId
                });
            });

            await page.pdf({
                path: pdfPath,
                width: '29.7cm',
                height: '16.7cm',
                printBackground: true,
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                timeout: 45000 // 45 seconds hard limit per PDF render
            });

            // Option B: Inject invisible metadata to PDF securely using pdf-lib
            try {
                const { PDFDocument } = require('pdf-lib');
                const pdfBuffer = fs.readFileSync(pdfPath);
                const pdfDoc = await PDFDocument.load(pdfBuffer);
                pdfDoc.setTitle(title || 'Presentation');
                pdfDoc.setAuthor('Aedos (aedoslab.xyz)');
                pdfDoc.setCreator('Aedos (aedoslab.xyz)');
                pdfDoc.setProducer('Aedos (aedoslab.xyz)');
                const pdfBytes = await pdfDoc.save();
                fs.writeFileSync(pdfPath, pdfBytes);
                log.info(ErrorCategory.PUPPETEER, 'Injected PDF metadata successfully');
            } catch (metaErr) {
                log.warn(ErrorCategory.PUPPETEER, 'PDF metadata injection failed (non-fatal)', {
                    error: metaErr.message
                });
            }
        } finally {
            await page.close();
        }

        const safeTitle = title ? title.replace(/[\/\\?%*:|<|>]/g, '-').trim() : 'Presentacion';
        res.set('Cache-Control', 'no-store');
        res.json({ pdfUrl: `/download/${pdfFilename}?name=${encodeURIComponent(safeTitle)}` });
        log.success(ErrorCategory.PUPPETEER, 'PDF generated successfully', {
            requestId,
            pdfFilename
        });

        setTimeout(() => {
            if (fs.existsSync(pdfPath)) {
                fs.unlink(pdfPath, () => { });
                log.info(ErrorCategory.FILESYSTEM, 'Auto-deleted unclaimed PDF', {
                    pdfFilename
                });
            }
        }, DOWNLOAD_TTL_MS);
    } catch (error) {
        log.error(classifyError(error, ErrorCategory.PUPPETEER), 'Failed to finalize PDF', {
            requestId,
            error
        });
        res.status(500).json({ error: 'Error generating PDF: ' + (error.message || error) });
    } finally {
        activeFinalize--;
        processFinalizeQueue();
    }
});

registerDownloadRoute(app, { tmpDir: TMP_DIR, log, classifyError, ErrorCategory });

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
