require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { runPipeline, buildLegacyPrompt } = require('./prompts/pipeline');
const buildPrompt = require('./prompts/base'); // kept for fallback

const { createLogger, classifyError, ErrorCategory } = require('./utils/logger');
const { verifyConnection: verifyRedis, checkRateLimits, checkFinalizeLimits } = require('./utils/rate-limiter');

const log = createLogger({ scope: 'SERVER' });
const providerLog = log.child('PROVIDER');
const queueLog = log.child('QUEUE');
const sanitizerLog = log.child('SANITIZER');
const devLog = log.child('DEV');
const puppeteerLog = log.child('PUPPETEER');

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
const PORT = process.env.PORT || 3000;
const RUNTIME_ENV = (process.env.NODE_ENV || 'development').toLowerCase();
const IS_DEVELOPMENT = RUNTIME_ENV === 'development';
const TMP_DIR = path.join(__dirname, '..', '..', 'tmp');
const EXAMPLES_DIR = path.join(__dirname, '..', '..', 'examples');
const EXAMPLES_FLASH_DIR = path.join(EXAMPLES_DIR, 'flash');
const EXAMPLES_PRO_DIR = path.join(EXAMPLES_DIR, 'pro');
let requestSequence = 0;

// Queue System State
let activeGenerations = 0;
const queue = [];
// Max concurrent generations 
const MAX_CONCURRENT_GENERATIONS = parsePositiveInt(process.env.MAX_CONCURRENT_GENERATIONS, 10);
const MAX_QUEUE_DEPTH = parsePositiveInt(process.env.MAX_QUEUE_DEPTH, 40);
const PRO_PAUSE_QUEUE_DEPTH = parsePositiveInt(
    process.env.PRO_PAUSE_QUEUE_DEPTH,
    Math.max(8, Math.floor(MAX_QUEUE_DEPTH * 0.6))
);
const PRO_PAUSE_ACTIVE_GENERATIONS = parsePositiveInt(
    process.env.PRO_PAUSE_ACTIVE_GENERATIONS,
    Math.max(1, MAX_CONCURRENT_GENERATIONS - 2)
);
const PRESSURE_RETRY_AFTER_SEC = parsePositiveInt(process.env.PRESSURE_RETRY_AFTER_SEC, 30);

// Puppeteer System State
let activeFinalize = 0;
const finalizeQueue = [];
const PUPPETEER_MAX_CONCURRENT = parsePositiveInt(process.env.PUPPETEER_MAX_CONCURRENT, 3);
const PUPPETEER_MAX_QUEUE = parsePositiveInt(process.env.PUPPETEER_MAX_QUEUE, 10);

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
        return res.status(429).json({
            error: 'QUEUE_FULL',
            retryAfterSec: PRESSURE_RETRY_AFTER_SEC,
            message: 'The PDF generation server is at capacity. Please try again in a few seconds.'
        });
    }
    next();
}

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
        return res.status(503).json({
            error: 'PRO_TEMPORARILY_PAUSED',
            retryAfterSec: PRESSURE_RETRY_AFTER_SEC,
            message: 'Pro mode is temporarily paused due to high system load. Please retry shortly or use Flash mode.'
        });
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
        return res.status(429).json({
            error: 'QUEUE_FULL',
            retryAfterSec: PRESSURE_RETRY_AFTER_SEC,
            message: 'The generation queue is full. Please try again in a few seconds.'
        });
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

// Model lists ordered from .env
const OPENROUTER_MODELS_FLASH = parseModelList(
    process.env.OPENROUTER_MODELS_FLASH,
    'qwen/qwen3.5-flash-02-23'
);
const OPENROUTER_MODELS_STAGE1 = parseModelList(
    process.env.OPENROUTER_MODELS_STAGE1,
    'qwen/qwen3.5-flash-02-23'
);
const OPENROUTER_MODELS_STAGE2 = parseModelList(
    process.env.OPENROUTER_MODELS_STAGE2,
    'qwen/qwen3.5-flash-02-23'
);
const OPENROUTER_MODELS_STAGE3 = parseModelList(
    process.env.OPENROUTER_MODELS_STAGE3,
    'minimax/minimax-m2.7'
);

const OPENROUTER_MODEL_LIST = OPENROUTER_MODELS_FLASH;

// Models that must never run outside Stage3 (configured in .env).
const OPENROUTER_MODELS_STAGE3_ONLY = parseModelList(
    process.env.OPENROUTER_MODELS_STAGE3_ONLY,
    ''
).map(model => String(model).trim().toLowerCase());

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

    if (process.env.OPENROUTER_API_KEY) {
        log.success(ErrorCategory.CONFIG, 'OpenRouter API key present', {
            flash: 'OPENROUTER_MODELS_FLASH',
            stage1: 'OPENROUTER_MODELS_STAGE1',
            stage2: 'OPENROUTER_MODELS_STAGE2',
            stage3: 'OPENROUTER_MODELS_STAGE3'
        });
    } else {
        throw new Error('OPENROUTER_API_KEY is required.');
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
            "img-src 'self' data: blob:",
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
ensureDirectory(TMP_DIR, 'Temporary');
if (IS_DEVELOPMENT) {
    ensureDirectory(EXAMPLES_DIR, 'Examples');
    ensureDirectory(EXAMPLES_FLASH_DIR, 'Examples flash');
    ensureDirectory(EXAMPLES_PRO_DIR, 'Examples pro');
}

// Strips <script> blocks, inline event handlers, and javascript: URLs from
// AI-generated HTML before it is sent to the client. Defense-in-depth layer
// complementing the identical sanitization already done on the client side.
function sanitizeGeneratedHtml(html) {
    if (typeof html !== 'string') return html;
    // Remove all <script>...</script> blocks — server re-injects only known-safe ones
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    // Remove orphan opening script tags
    html = html.replace(/<script[^>]*>/gi, '');
    // Remove inline event handlers (onclick, onload, onerror, onmouseover, …)
    html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
    // Remove javascript: URLs in href / src / action attributes
    html = html.replace(/\s+(href|src|action)\s*=\s*["']javascript:[^"']*["']/gi, '');
    // Remove ALL Google Fonts <link> tags produced by the AI.
    // The server always injects its own verified font links immediately after
    // this sanitization step, so AI-provided ones are redundant. Removing them
    // also eliminates any malformed href="url('...')" syntax that causes:
    //   "Refused to apply style … MIME type text/html"
    html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*\/?>/gi, '');
    return html;
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

// Safety settings removed as they were Gemini-specific.

// Provider logic simplified to OpenRouter only

// ── OpenRouter fallback (try a list of models sequentially) ───────────────────
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

async function callOpenRouter(prompt, stageName, openrouterModels) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('QUOTA_EXHAUSTED'); // no key → surface original error

    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

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

    // Try each configured OpenRouter model until one responds
    for (const model of modelsToTry) {
        providerLog.info(ErrorCategory.PROVIDER, 'Trying OpenRouter model', {
            stage: stageName,
            model
        });
        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.APP_URL || 'https://aedos.app',
                    'X-Title': 'Aedos'
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: promptText }],
                    stream: true
                })
            });

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
                model
            });
            return { stream: openRouterSSEToChunks(response) };
        } catch (err) {
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


/**
 * Builds a caller that tries OpenRouter models in order.
 */
function makeCallerFn(stageName, modelList) {
    return async function (prompt) {
        return await callOpenRouter(prompt, stageName, modelList);
    };
}

// Stage routing
const tryModelsFlash = makeCallerFn('Flash', OPENROUTER_MODELS_FLASH);
const tryModelsStage1 = makeCallerFn('Stage1', OPENROUTER_MODELS_STAGE1);
const tryModelsStage2 = makeCallerFn('Stage2', OPENROUTER_MODELS_STAGE2);
const tryModelsStage3 = makeCallerFn('Stage3', OPENROUTER_MODELS_STAGE3);

// Legacy alias kept for any remaining references
const tryModels = tryModelsFlash;


// Global Puppeteer Browser Instance
let browser;

async function initBrowser() {
    try {
        const launchOptions = {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote'
            ]
        };

        browser = await puppeteer.launch(launchOptions);
        puppeteerLog.success(ErrorCategory.PUPPETEER, 'Puppeteer browser initialized');
    } catch (error) {
        // Deep debug of the cache directory if initialization fails
        let cacheDebug = {};
        try {
            const cachePath = path.join(__dirname, '..', '..', 'puppeteer-cache');
            if (fs.existsSync(cachePath)) {
                cacheDebug.exists = true;
                cacheDebug.contents = fs.readdirSync(cachePath, { recursive: true }).slice(0, 20);
            } else {
                cacheDebug.exists = false;
                // Check if the old hidden path exists by any chance
                const oldPath = path.join(__dirname, '..', '..', '.cache', 'puppeteer');
                cacheDebug.oldPathExists = fs.existsSync(oldPath);
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
    // Security: If someone hits the Render URL directly in production, redirect to the main domain.
    // We allow 'localhost' so Puppeteer can still render the slides internally.
    const host = req.headers.host || '';
    if (process.env.NODE_ENV === 'production' && !host.includes('localhost')) {
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

    const cleanedString = input.trim().replace(/\s+/g, ' ').substring(0, 600);
    return { valid: true, tema: cleanedString };
}

app.post('/generate', express.json({ limit: '8kb' }), checkGenerationPressure, checkRateLimits, async (req, res) => {
    let cancelled = false;
    let completed = false;
    let sseKeepAlive = null;
    let hasGenerationSlot = false;
    const requestId = req.requestId || 'n/a';

    res.on('close', () => {
        if (!completed) {
            log.warn(ErrorCategory.STREAM, 'Client disconnected before generation completed', {
                requestId
            });
            cancelled = true;
        }
    });

    try {
        const opciones = req.body;
        log.info(ErrorCategory.PIPELINE, 'Generation request accepted', {
            requestId,
            mode: req.body.mode === 'pro' ? 'pro' : 'flash',
            idioma: req.body.idioma || 'es',
            requestedSlides: req.body.slides
        });

        const rawTema = opciones.tema || '';
        const sanitizeResult = sanitizeTema(String(rawTema));
        if (!sanitizeResult.valid) {
            log.warn(ErrorCategory.VALIDATION, 'Topic rejected by sanitizer', {
                requestId,
                reason: sanitizeResult.reason
            });
            return res.status(400).json({ error: `Invalid topic: ${sanitizeResult.reason}` });
        }

        opciones.tema = sanitizeResult.tema;

        // Flash mode (single-prompt, default) vs Pro mode (3-stage pipeline)
        const usePipeline = req.body.mode === 'pro';

        let slidesNum = req.body.slides !== undefined ? parseInt(req.body.slides, 10) : 5;
        if (isNaN(slidesNum) || slidesNum < 1 || slidesNum > 15) {
            log.warn(ErrorCategory.VALIDATION, 'Slides validation failed', {
                requestId,
                slides: req.body.slides
            });
            return res.status(422).json({
                error: 'Validation failed',
                fields: { slides: 'must be integer between 1 and 15' }
            });
        }

        // Cap the actual slides requested to the AI based on the mode
        const slideHardLimit = usePipeline ? 8 : 15;
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
            return res.status(422).json({
                error: 'Validation failed',
                fields: { idioma: 'must be one of: es, en, fr, pt, de' }
            });
        }

        if (!process.env.OPENROUTER_API_KEY) {
            log.error(ErrorCategory.CONFIG, 'Generation blocked: OpenRouter key missing', {
                requestId
            });
            return res.status(500).json({ error: 'OpenRouter API Key is not configured in .env' });
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Keep the SSE stream alive during slow model responses so the browser/proxy
        // does not assume the request stalled while OpenRouter is still generating.
        sseKeepAlive = setInterval(() => {
            if (!completed && !cancelled && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({ heartbeat: true })}\n\n`);
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
                res.write(`data: ${JSON.stringify({ error: 'QUEUE_FULL', retryAfterSec: PRESSURE_RETRY_AFTER_SEC })}\n\n`);
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
                res.write(`data: ${JSON.stringify({ error: 'PRO_TEMPORARILY_PAUSED', retryAfterSec: PRESSURE_RETRY_AFTER_SEC })}\n\n`);
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
            res.write(`data: ${JSON.stringify({ queued: true, position: queue.length + 1 })}\n\n`);
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
            res.write(`data: ${JSON.stringify({ queued: false })}\n\n`);
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
        let result;
        if (!usePipeline) {
            // Flash mode — single-prompt path (default)
            const prompt = buildPrompt(opciones);
            log.info(ErrorCategory.PIPELINE, 'Running flash generation path', { requestId });
            result = await tryModels(prompt);
        } else {
            // Pro mode — 3-Stage Pipeline: Content → Design → HTML
            log.info(ErrorCategory.PIPELINE, 'Running pro pipeline path', { requestId });
            res.write(`data: ${JSON.stringify({ pipeline: true, stage: 'content', status: 'running' })}\n\n`);

            const pipelineResult = await runPipeline({
                rawInput: opciones.tema,
                maxSlides: slideHardLimit,
                tryModelsStage1,
                tryModelsStage2,
                tryModelsStage3,
                onStageUpdate: (stage, data) => {
                    if (!cancelled) {
                        const stageNames = { stage1: 'content', stage2: 'design', stage3: 'compositing' };
                        res.write(`data: ${JSON.stringify({ pipeline: true, stage: stageNames[stage] || stage, ...data })}\n\n`);
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

            result = pipelineResult.stage3Stream;
            log.info(ErrorCategory.PIPELINE, 'Stage 3 stream ready, starting SSE forwarding', {
                requestId
            });
        }

        let fullHtml = '';
        let hasStartedValidContent = false;

        // Strip backticks AND Google Fonts <link> tags from SSE chunks.
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

        try {
            let streamSlideCount = 0;
            const slideTagRegex = /<section[^>]*\bclass="[^"]*\bs\b[^"]*"[^>]*>/gi;

            for await (const chunk of result.stream) {
                if (cancelled) {
                    log.warn(ErrorCategory.STREAM, 'Generation loop stopped because client disconnected', {
                        requestId
                    });
                    break;
                }
                let chunkText = "";
                chunkText = chunk;

                if (!chunkText) continue;

                // Stop AI hallucination: If we detect more slides than allowed, kill the stream immediately to save tokens.
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

                let cleanChunk = cleanSSEChunk(chunkText);

                if (!hasStartedValidContent) {
                    const matchIdx = fullHtml.indexOf('<!-- CONFIG');
                    const htmlIdx = fullHtml.indexOf('<html');

                    if (matchIdx !== -1) {
                        hasStartedValidContent = true;
                        const validContentStart = fullHtml.substring(matchIdx);
                        cleanChunk = cleanSSEChunk(validContentStart);
                        res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
                    } else if (htmlIdx !== -1) {
                        hasStartedValidContent = true;
                        const validContentStart = fullHtml.substring(htmlIdx);
                        cleanChunk = cleanSSEChunk(validContentStart);
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
            const isParseError = streamErr.message && streamErr.message.includes('parse stream');
            if (isParseError && fullHtml.length > 200) {
                const hasStyleBlock = /<style[\s\S]*?section\.s[\s\S]*?<\/style>/i.test(fullHtml)
                    || /<style[\s\S]*?--bg[\s\S]*?<\/style>/i.test(fullHtml);
                if (hasStyleBlock) {
                    log.warn(ErrorCategory.STREAM, 'Recovered from stream parse error because CSS was already present', {
                        requestId,
                        htmlChars: fullHtml.length
                    });
                } else {
                    log.warn(ErrorCategory.STREAM, 'Stream parse error without CSS, aborting generation', {
                        requestId,
                        htmlChars: fullHtml.length
                    });
                    res.write(`data: ${JSON.stringify({ error: 'Stream ended before CSS was generated. Please try again.' })}\n\n`);
                    res.end();
                    return;
                }
            } else {
                log.error(classifyError(streamErr, ErrorCategory.STREAM), 'Error while streaming presentation output', {
                    requestId,
                    error: streamErr
                });
                res.write(`data: ${JSON.stringify({ error: streamErr.message })}\n\n`);
                res.end();
                return;
            }
        }

        if (cancelled) {
            res.end();
            return;
        }

        // 6. Clean the full response
        let finalHtml = fullHtml.replace(/^```html\n?/m, '').replace(/^```\n?/m, '').replace(/```\n?$/m, '').trim();

        // 6.5 Remove any existing CSP meta tags to avoid conflicts
        finalHtml = finalHtml.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '');

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
            const MAX_SLIDES = usePipeline ? 8 : 15;
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

            const lucideSrc = 'https://unpkg.com/lucide@0.577.0/dist/umd/lucide.min.js';
            const lucideIntegrity = 'sha384-orgVf2eX2+m1zKAOIi09hD0W6GtVhoOUmqDK+sysYB2JTZ4vS86j4jm+X7a4Nnei';
            // Strip any @import the AI put for Google Fonts — the server injects the definitive
            // 23-family link below. Removing duplicates avoids double-downloading font CSS.
            cleanedOutput = cleanedOutput.replace(/@import\s+url\(['"]?https:\/\/fonts\.googleapis\.com\/[^'"\)]+['"]?\)\s*;?\s*/gi, '');

            // The editor's font picker (tools.js) applies any of 23 Google Fonts to elements
            // INSIDE the iframe. All 23 must be available in the iframe document.
            // One canonical <link> here replaces whatever @import the AI had.
            // 1. Ensure Google Fonts and Lucide library are present
            const G_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
            const headInjection = G_FONTS + (!cleanedOutput.includes(lucideSrc) ? `\n<script src="${lucideSrc}" integrity="${lucideIntegrity}" crossorigin="anonymous"></script>` : '');

            if (headInjection) {
                if (cleanedOutput.includes('</head>')) {
                    cleanedOutput = cleanedOutput.replace(/<\/head>/i, `${headInjection}\n</head>`);
                } else if (cleanedOutput.includes('<head>')) {
                    cleanedOutput = cleanedOutput.replace(/<head>/i, `<head>\n${headInjection}`);
                } else {
                    cleanedOutput = `${headInjection}\n` + cleanedOutput;
                }
                sanitizerLog.info(ErrorCategory.SANITIZER, 'Injected Google Fonts and Lucide library');
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
            error.message.startsWith('CONTENT_REJECTED')
        );

        let userMessage;
        if (isQuotaError) {
            userMessage = 'The AI service has reached its usage limit. Please try again in a few minutes.';
            log.warn(ErrorCategory.QUOTA, 'All configured models are quota exhausted', {
                requestId
            });
        } else if (isPipelineError) {
            userMessage = 'The AI had trouble understanding the request. Please try rephrasing or adding more detail.';
            log.error(ErrorCategory.PIPELINE, 'Pipeline generation failed', {
                requestId,
                details: error.message
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
        } else {
            res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
            res.end();
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

// Finalize: receive (possibly modified) HTML, convert to PDF
app.post('/finalize', express.json({ limit: '50mb' }), checkFinalizePressure, checkFinalizeLimits, async (req, res) => {
    const requestId = req.requestId || 'n/a';

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
        if (html.length > 2 * 1024 * 1024) { // 2MB
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

        // Replace animated GIFs with a 1×1 transparent placeholder so Puppeteer
        // doesn't time-out or crash while trying to load/decode animation frames.
        const TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        // Add a <base> tag so root-relative paths like /features/shared/lucide-init.js resolve to this server.
        // Puppeteer uses page.setContent() which has no inherent base URL.
        const baseTag = `<base href="http://localhost:${PORT}/">`;
        let processedHtml = html.includes('<base') ? html : html.replace(/(<head[^>]*>)/i, `$1\n${baseTag}`);
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
        }, 10 * 60 * 1000);
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

app.get('/download/:filename', (req, res) => {
    const requestId = req.requestId || 'n/a';
    const filename = req.params.filename;

    // Security: avoid path traversal
    if (filename.includes('/') || filename.includes('..')) {
        log.warn(ErrorCategory.SECURITY, 'Blocked download path traversal attempt', {
            requestId,
            filename
        });
        return res.status(400).send('Invalid file');
    }

    const filePath = path.join(TMP_DIR, filename);

    // Stop if file doesn't exist
    if (!fs.existsSync(filePath)) {
        log.warn(ErrorCategory.DOWNLOAD, 'Download failed: file not found', {
            requestId,
            filename
        });
        return res.status(404).send('File not found');
    }

    // Send it with res.download() and delete it afterwards
    res.set('Cache-Control', 'no-store');
    let downloadName = req.query.name ? req.query.name : filename;
    if (!downloadName.toLowerCase().endsWith('.pdf')) {
        downloadName += '.pdf';
    }

    res.download(filePath, downloadName, (err) => {
        if (err) {
            log.error(classifyError(err, ErrorCategory.DOWNLOAD), 'Error sending download file', {
                requestId,
                filename,
                error: err
            });
        } else {
            log.success(ErrorCategory.DOWNLOAD, 'File downloaded successfully', {
                requestId,
                filename,
                downloadName
            });
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) {
                    log.error(classifyError(unlinkErr, ErrorCategory.FILESYSTEM), 'Failed to delete temporary file after download', {
                        requestId,
                        filename,
                        error: unlinkErr
                    });
                }
            });
        }
    });
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
        server.requestTimeout = 10 * 60 * 1000;
        server.headersTimeout = 11 * 60 * 1000;
    });
}

module.exports = { sanitizeTema, buildPrompt };
