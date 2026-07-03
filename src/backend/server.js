require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Force Puppeteer to use a visible cache directory BEFORE requiring it.
// This matches the PUPPETEER_CACHE_DIR set in package.json.
process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, '..', '..', 'puppeteer-cache');
const puppeteer = require('puppeteer');
const multer = require('multer');
const allowedExtensions = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp'];
const upload = multer({
    dest: path.join(__dirname, '..', '..', 'tmp'),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max per file
        files: 3 // Max 3 files per request
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
            return cb(new Error('Invalid file type. Only PDF, Office Word, and images are allowed.'), false);
        }
        cb(null, true);
    }
});
const mammoth = require('mammoth');

const { runPipeline, buildLegacyPrompt, extractJson } = require('./prompts/pipeline');
const buildPrompt = require('./prompts/base'); // kept for fallback
const { buildStage1Prompt, buildStage1RevisionPrompt } = require('./prompts/stage1-content');
const { buildAddSlidePrompt, buildAddPointPrompt } = require('./prompts/skeleton_prompts');

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

// OpenRouter fallback model lists (read from .env)
const OPENROUTER_MODELS_FLASH = parseModelList(
    process.env.OPENROUTER_MODELS_FLASH,
    'google/gemini-2.5-flash-lite'
);
const OPENROUTER_MODELS_STAGE1 = parseModelList(
    process.env.OPENROUTER_MODELS_STAGE1,
    'google/gemini-2.5-flash-lite'
);
const OPENROUTER_MODELS_STAGE2 = parseModelList(
    process.env.OPENROUTER_MODELS_STAGE2,
    'google/gemini-2.5-flash-lite'
);
const OPENROUTER_MODELS_STAGE3 = parseModelList(
    process.env.OPENROUTER_MODELS_STAGE3,
    'google/gemini-3-flash-preview'
);

const OPENROUTER_MODEL_LIST = OPENROUTER_MODELS_FLASH;

// Models that must never run outside Stage3 (configured in .env).
const OPENROUTER_MODELS_STAGE3_ONLY = parseModelList(
    process.env.OPENROUTER_MODELS_STAGE3_ONLY,
    ''
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
const GEMINI_MODEL_FLASH  = (process.env.GEMINI_MODELS_FLASH  || 'gemini-3-flash-preview').trim();
const GEMINI_MODEL_STAGE1 = (process.env.GEMINI_MODELS_STAGE1 || 'gemini-2.5-flash-lite').trim();
const GEMINI_MODEL_STAGE2 = (process.env.GEMINI_MODELS_STAGE2 || 'gemini-2.5-flash-lite').trim();
const GEMINI_MODEL_STAGE3 = (process.env.GEMINI_MODELS_STAGE3 || 'gemini-3.5-flash').trim();

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

// Redirect the raw Render URL to the canonical domain BEFORE static files are
// served. express.static intercepts GET / and sends index.html directly,
// bypassing any app.get('/') route handler registered afterwards.
if ((process.env.NODE_ENV || 'development') === 'production') {
    app.use((req, res, next) => {
        const host = req.headers.host || '';
        const path = req.path || '';

        // IMPORTANT: Do NOT redirect API routes or health checks.
        // Vercel proxies these routes to Render, and they must be served directly.
        const isApiRoute = /^\/(generate|finalize|download|health|__dev__)/.test(path);

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
ensureDirectory(TMP_DIR, 'Temporary');
if (IS_DEVELOPMENT) {
    ensureDirectory(EXAMPLES_DIR, 'Examples');
    ensureDirectory(EXAMPLES_FLASH_DIR, 'Examples flash');
    ensureDirectory(EXAMPLES_PRO_DIR, 'Examples pro');
}

// ── Image injection using Puppeteer to scrape DuckDuckGo Images (with Pixabay fallback) ───────────
/**
 * After Stage 3 HTML is complete, finds all img-slot elements with a
 * data-image-keyword attribute, scrapes DuckDuckGo Images for a matching photo,
 * if that fails, uses Pixabay, downloads, converts to data:URI and injects as background-image.
 * If anything fails, falls back to the gradient placeholder.
 */
async function fetchImages(html) {
    const debugImages = process.env.NODE_ENV !== 'production';
    const debugImageLog = (...args) => {
        if (debugImages) console.log(...args);
    };
    const slotTagRegex = /<div\b[^>]*(?:class\s*=\s*["'][^"']*\bimg-slot\b[^"']*["']|data-image-slot\s*=\s*["'][^"']+["'])[^>]*>/gi;
    const slots = [];
    const seenSlotIds = new Set();
    const usedImageFingerprints = new Set();
    let autoSlotCounter = 1;

    function toPositiveInt(value) {
        const parsed = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function normalizeImageFingerprint(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url);
            parsed.hash = '';
            parsed.search = '';
            return parsed.toString();
        } catch (_) {
            return String(url).split('#')[0].split('?')[0];
        }
    }

    function stableHash(input) {
        let hash = 0;
        const text = String(input || '');
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    function tokenizeKeyword(keyword) {
        return String(keyword || '')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map(token => token.trim())
            .filter(token => token.length >= 3);
    }

    function scoreImageCandidate(candidate, slot, indexHint = 0) {
        const width = toPositiveInt(candidate.width);
        const height = toPositiveInt(candidate.height);
        const area = width * height;
        const aspect = width && height ? width / height : 0;
        const url = String(candidate.imageUrl || '').toLowerCase();
        const metadata = `${candidate.title || ''} ${candidate.sourceUrl || ''}`.toLowerCase();
        const tokens = tokenizeKeyword(slot.keyword);
        const fingerprint = candidate.fingerprint || normalizeImageFingerprint(candidate.imageUrl);
        let score = 0;

        if (!candidate.imageUrl || !/^https?:\/\//i.test(candidate.imageUrl)) return -Infinity;
        if (url.endsWith('.svg') || url.includes('.svg?')) return -Infinity;

        if (area >= 2400000) score += 90;
        else if (area >= 1600000) score += 70;
        else if (area >= 1000000) score += 45;
        else if (area >= 500000) score += 20;
        else if (area > 0) score -= 30;

        if (width >= 1600) score += 25;
        else if (width >= 1280) score += 15;
        else if (width > 0 && width < 900) score -= 15;

        if (aspect >= 1.2 && aspect <= 2.2) score += 18;
        else if (aspect >= 0.9 && aspect <= 2.8) score += 6;
        else if (aspect > 0) score -= 18;

        if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) score += 4;
        if (metadata.includes('thumbnail') || metadata.includes('icon') || metadata.includes('logo')) score -= 35;

        let tokenHits = 0;
        for (const token of tokens) {
            if (metadata.includes(token)) tokenHits += 1;
        }
        score += Math.min(20, tokenHits * 4);

        if (usedImageFingerprints.has(fingerprint)) score -= 400;
        score -= indexHint * 2;
        return score;
    }

    function buildCandidatePool(rawCandidates, slot) {
        return rawCandidates
            .map((candidate, index) => {
                const imageUrl = candidate.imageUrl || candidate.image || candidate.largeImageURL || candidate.fullHDURL || candidate.webformatURL;
                const fingerprint = candidate.fingerprint || normalizeImageFingerprint(imageUrl);
                return {
                    ...candidate,
                    imageUrl,
                    fingerprint,
                    score: scoreImageCandidate({ ...candidate, imageUrl, fingerprint }, slot, index)
                };
            })
            .filter(candidate => Number.isFinite(candidate.score))
            .sort((a, b) => b.score - a.score);
    }

    function buildDownloadOrder(candidates, slot) {
        if (!candidates.length) return [];
        const unused = candidates.filter(candidate => !usedImageFingerprints.has(candidate.fingerprint));
        const pool = (unused.length ? unused : candidates).slice(0, Math.min(8, unused.length || candidates.length));
        if (pool.length <= 1) return pool;

        // Rotate among the top-scoring unused candidates so identical/near-identical
        // keywords across slides do not always land on the exact same photo.
        const rotationBase = Math.min(3, pool.length);
        const rotation = stableHash(`${slot.slotId}|${slot.keyword}`) % rotationBase;
        return [...pool.slice(rotation), ...pool.slice(0, rotation)];
    }

    function parseTagAttributes(tag) {
        const attrs = {};
        const attrRegex = /([:@\w-]+)\s*=\s*["']([^"']*)["']/g;
        let match;
        while ((match = attrRegex.exec(tag)) !== null) {
            attrs[match[1].toLowerCase()] = match[2];
        }
        return attrs;
    }

    debugImageLog('[DEBUG IMAGES] Buscando slots en el HTML...');
    let tagMatch;
    while ((tagMatch = slotTagRegex.exec(html)) !== null) {
        const openTag = tagMatch[0];
        const attrs = parseTagAttributes(openTag);
        const keyword = decodeBasicHtmlEntities(attrs['data-image-keyword'] || attrs['data-keyword'] || '').trim();
        if (!keyword) continue;

        const explicitSlotId = String(attrs['data-image-slot'] || '').trim();
        const slotId = explicitSlotId || `auto-slot-${autoSlotCounter++}`;
        if (seenSlotIds.has(slotId)) continue;

        seenSlotIds.add(slotId);
        slots.push({
            slotId,
            keyword,
            openTag,
            hasExplicitSlotId: Boolean(explicitSlotId)
        });
        debugImageLog('[DEBUG IMAGES] Slot detectado:', {
            slotId,
            keyword,
            syntheticId: !explicitSlotId
        });
    }

    if (slots.length === 0) {
        debugImageLog('[DEBUG IMAGES] No se detectaron slots de imagen en el HTML');
        return html;
    }

    debugImageLog('[DEBUG IMAGES] Total de slots encontrados:', slots.length);

    /**
     * Fetches an image for a slot using DuckDuckGo's internal images API (/i.js).
     * This is a pure HTTP approach — no Puppeteer needed. Works in 2 steps:
     *   1. GET the DDG search page to extract the session vqd token
     *   2. GET /i.js with the token to get image results JSON
     * This returns real web images (anime, people, artworks, etc.) not stock photos.
     */
    async function fetchSlotImageDuckDuckGo(slot) {
        const DDG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
        try {
            debugImageLog(`[DEBUG IMAGES] Buscando "${slot.keyword}" en DuckDuckGo Images (API)...`);

            // Step 1: Get initial page to extract vqd session token
            const initUrl = `https://duckduckgo.com/?q=${encodeURIComponent(slot.keyword)}&iax=images&ia=images`;
            const initRes = await fetch(initUrl, {
                headers: {
                    'User-Agent': DDG_UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                },
                signal: AbortSignal.timeout(12000)
            });

            if (!initRes.ok) {
                debugImageLog(`[DEBUG IMAGES] DDG init page failed: ${initRes.status}`);
                return null;
            }

            const initHtml = await initRes.text();

            // Extract vqd token — DDG embeds it in script blocks as vqd='4-...' or "vqd":"4-..."
            const vqdMatch =
                initHtml.match(/vqd=["']?([\d-]+)["']?/) ||
                initHtml.match(/"vqd"\s*:\s*"([^"]+)"/) ||
                initHtml.match(/vqd%3D([\d-]+)/);

            if (!vqdMatch) {
                debugImageLog(`[DEBUG IMAGES] No se encontró token vqd de DuckDuckGo`);
                return null;
            }
            const vqd = vqdMatch[1];
            debugImageLog(`[DEBUG IMAGES] Token vqd obtenido: ${vqd.substring(0, 20)}...`);

            // Step 2: Query the internal images API
            const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(slot.keyword)}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=1&s=0`;
            const apiRes = await fetch(apiUrl, {
                headers: {
                    'User-Agent': DDG_UA,
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://duckduckgo.com/',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                signal: AbortSignal.timeout(12000)
            });

            if (!apiRes.ok) {
                debugImageLog(`[DEBUG IMAGES] DDG images API failed: ${apiRes.status}`);
                return null;
            }

            const data = await apiRes.json();
            const results = data?.results || [];

            if (results.length === 0) {
                debugImageLog(`[DEBUG IMAGES] DDG no encontró imágenes para "${slot.keyword}"`);
                return null;
            }

            debugImageLog(`[DEBUG IMAGES] DDG encontró ${results.length} imágenes para "${slot.keyword}"`);

            const candidates = buildCandidatePool(results.map(result => ({
                imageUrl: result?.image,
                sourceUrl: result?.url,
                title: result?.title,
                width: result?.width,
                height: result?.height
            })), slot);

            if (candidates.length === 0) {
                debugImageLog(`[DEBUG IMAGES] DDG no devolvió candidatos utilizables para "${slot.keyword}"`);
                return null;
            }

            const downloadOrder = buildDownloadOrder(candidates, slot);

            // Try the best candidates first, but rotate within the top set for variety.
            for (let i = 0; i < downloadOrder.length; i++) {
                const candidate = downloadOrder[i];
                const imageUrl = candidate.imageUrl;
                if (!imageUrl || !imageUrl.startsWith('http')) continue;

                try {
                    debugImageLog(`[DEBUG IMAGES] Descargando imagen ${i + 1} de DDG: ${imageUrl.substring(0, 80)}`, {
                        keyword: slot.keyword,
                        score: candidate.score,
                        width: candidate.width,
                        height: candidate.height
                    });
                    const imgRes = await fetch(imageUrl, {
                        headers: {
                            'User-Agent': DDG_UA,
                            'Referer': 'https://duckduckgo.com/',
                        },
                        signal: AbortSignal.timeout(10000)
                    });

                    if (imgRes.ok) {
                        const contentType = imgRes.headers.get('content-type') || '';
                        if (contentType.startsWith('image/')) {
                            const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                            // Reject suspiciously small files (likely error pages)
                            if (imgBuffer.length < 5000) {
                                debugImageLog(`[DEBUG IMAGES] Imagen ${i + 1} demasiado pequeña (${imgBuffer.length}B), saltando`);
                                continue;
                            }
                            usedImageFingerprints.add(candidate.fingerprint);
                            debugImageLog(`[DEBUG IMAGES] Imagen descargada de DDG para "${slot.keyword}" (${Math.round(imgBuffer.length / 1024)}KB)`);
                            return `data:${contentType};base64,${imgBuffer.toString('base64')}`;
                        }
                    }
                } catch (e) {
                    debugImageLog(`[DEBUG IMAGES] Error descargando imagen ${i + 1} de DDG:`, e.message);
                }
            }

            debugImageLog(`[DEBUG IMAGES] No se pudo descargar ninguna imagen de DDG para "${slot.keyword}"`);
            return null;
        } catch (err) {
            debugImageLog(`[DEBUG IMAGES] Error en DDG API para "${slot.keyword}":`, err.message);
            return null;
        }
    }

    async function fetchSlotImagePixabay(slot) {
        const apiKey = process.env.PIXABAY_API_KEY;
        if (!apiKey) return null;
        try {
            const query = encodeURIComponent(slot.keyword);
            const apiUrl = `https://pixabay.com/api/?key=${apiKey}&q=${query}&image_type=photo&per_page=10&safesearch=true&min_width=1024&orientation=horizontal&order=popular`;
            const searchRes = await fetch(apiUrl, { signal: AbortSignal.timeout(6000) });
            if (!searchRes.ok) return null;

            const data = await searchRes.json();
            const hits = data?.hits || [];
            if (hits.length === 0) return null;

            const candidates = buildCandidatePool(hits.map(hit => ({
                imageUrl: hit.largeImageURL || hit.fullHDURL || hit.webformatURL,
                sourceUrl: hit.pageURL,
                title: hit.tags,
                width: hit.imageWidth || hit.webformatWidth,
                height: hit.imageHeight || hit.webformatHeight,
                fingerprint: hit.id ? `pixabay:${hit.id}` : normalizeImageFingerprint(hit.largeImageURL || hit.fullHDURL || hit.webformatURL),
                downloads: hit.downloads || 0,
                likes: hit.likes || 0
            })).map(candidate => ({
                ...candidate,
                width: candidate.width,
                height: candidate.height,
                title: `${candidate.title || ''} downloads:${candidate.downloads} likes:${candidate.likes}`
            })), slot);

            const downloadOrder = buildDownloadOrder(candidates, slot);
            for (const candidate of downloadOrder) {
                if (!candidate.imageUrl) continue;
                const imgRes = await fetch(candidate.imageUrl, { signal: AbortSignal.timeout(8000) });
                if (!imgRes.ok) continue;

                const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                if (imgBuffer.length < 5000) continue;
                const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                usedImageFingerprints.add(candidate.fingerprint);
                return `data:${contentType};base64,${imgBuffer.toString('base64')}`;
            }
            return null;
        } catch (err) {
            debugImageLog(`[DEBUG IMAGES] Error en Pixabay para "${slot.keyword}":`, err.message);
            return null;
        }
    }

    const results = [];
    for (const slot of slots) {
        let dataUri = null;
        // DuckDuckGo first — it searches the real web (anime, characters, artworks, etc.)
        dataUri = await fetchSlotImageDuckDuckGo(slot);
        if (!dataUri) {
            // Pixabay as fallback — only good for generic stock photos
            debugImageLog(`[DEBUG IMAGES] DDG falló, usando Pixabay para "${slot.keyword}"`);
            dataUri = await fetchSlotImagePixabay(slot);
        }
        results.push(dataUri ? { slot, dataUri } : null);
    }

    for (const result of results) {
        if (!result) continue;
        const { slot, dataUri } = result;
        let newOpenTag = slot.openTag;
        debugImageLog('[DEBUG IMAGES] Aplicando imagen al slot:', slot.slotId);

        if (!slot.hasExplicitSlotId) {
            newOpenTag = newOpenTag.replace(/>$/, ` data-image-slot="${slot.slotId}">`);
        }

        if (/class\s*=/.test(newOpenTag)) {
            newOpenTag = newOpenTag.replace(/(class\s*=\s*["'])([^"']*)(["'])/, (_, qOpen, classes, qClose) =>
                classes.includes('has-custom-image') ? `${qOpen}${classes}${qClose}` : `${qOpen}${classes} has-custom-image${qClose}`
            );
        } else {
            newOpenTag = newOpenTag.replace(/>$/, ' class="has-custom-image">');
        }

        if (/style\s*=/.test(newOpenTag)) {
            newOpenTag = newOpenTag.replace(/(style\s*=\s*["'])([^"']*)(["'])/, (_, qOpen, style, qClose) => {
                const bgStyle = `background-image:url('${dataUri}');background-size:cover;background-position:center`;
                return /background-image\s*:/.test(style)
                    ? `${qOpen}${style.replace(/background-image\s*:[^;"]*;?/gi, `${bgStyle};`)}${qClose}`
                    : `${qOpen}${style}${style.trim().endsWith(';') ? '' : ';'}${bgStyle};${qClose}`;
            });
        } else {
            newOpenTag = newOpenTag.replace(/>$/, ` style="background-image:url('${dataUri}');background-size:cover;background-position:center">`);
        }

        html = html.replace(slot.openTag, newOpenTag);
    }
    
    html = html.replace(/<div[^>]*class\s*=\s*["'][^"']*img-bg1[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
    html = html.replace(/<div[^>]*class\s*=\s*["'][^"']*img-bg2[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
    html = html.replace(/<div[^>]*class\s*=\s*["'][^"']*img-replace-overlay[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

    debugImageLog('[DEBUG IMAGES] Inyeccion de imagenes completada');
    return html;
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
    // Remove malformed Google Fonts <link> tags such as href="url('https://...')".
    // Valid AI-provided font links are preserved so the final deck keeps the
    // original typography chosen during generation.
    html = html.replace(/<link[^>]*href\s*=\s*["']\s*url\(\s*['"]?https:\/\/fonts\.googleapis\.com[\s\S]*?\/?>/gi, '');
    return html;
}

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
const PROVIDER_ACCEPT_TIMEOUT_MS = 10000;

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

        // Priority 1: Find chrome-headless-shell binary (modern Puppeteer preference)
        const shell = files.find(f => {
            const base = path.basename(String(f));
            if (base !== 'chrome-headless-shell') return false;
            if (String(f).includes('.zip')) return false;
            return isFile(path.join(cacheDir, String(f)));
        });
        if (shell) return path.join(cacheDir, String(shell));

        // Priority 2: Find standard chrome binary
        const chrome = files.find(f => {
            const base = path.basename(String(f));
            if (base !== 'chrome') return false;
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
    // Bash-style VAR=value env assignment doesn't work on Windows.
    // On dev machines Chrome is already found via Puppeteer's default cache, so skip.
    if (process.platform === 'win32') return;
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
            `PUPPETEER_CACHE_DIR="${cacheDir}" npx puppeteer browsers install chrome-headless-shell`,
            { stdio: 'pipe', timeout: 5 * 60 * 1000, cwd: path.join(__dirname, '..', '..') }
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

    const cleanedString = input.trim().replace(/\s+/g, ' ').substring(0, 600);
    return { valid: true, tema: cleanedString };
}

app.post('/generate-skeleton', upload.array('files', 5), express.json({ limit: '8kb' }), checkGenerationPressure, checkRateLimits, async (req, res) => {
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

    try {
        const opciones = req.body;
        const requestedLanguage = req.body.language || req.body.idioma || 'auto';
        
        const rawTema = opciones.tema || '';
        const sanitizeResult = sanitizeTema(String(rawTema));
        if (!sanitizeResult.valid) {
            return res.status(400).json({ error: `Invalid topic: ${sanitizeResult.reason}` });
        }

        const targetLang = requestedLanguage;
        
        let fileContext = null;
        if (req.files && req.files.length > 0) {
            fileContext = [];
            const MIME_BY_EXT = {
                '.pdf':  'application/pdf',
                '.doc':  'application/msword',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                '.png':  'image/png',
                '.jpg':  'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp'
            };

            for (const file of req.files) {
                try {
                    const ext = path.extname(file.originalname).toLowerCase();
                    const mimeType = MIME_BY_EXT[ext] || file.mimetype;

                    if (ext === '.docx' || ext === '.doc') {
                        const extracted = await mammoth.extractRawText({ path: file.path });
                        fileContext.push({ type: 'text', text: `Content from ${file.originalname}:\n\n${extracted.value}` });
                        continue;
                    }

                    const fileData = fs.readFileSync(file.path);
                    const base64Data = fileData.toString('base64');
                    const dataUrl = `data:${mimeType};base64,${base64Data}`;

                    if (mimeType.startsWith('image/')) {
                        fileContext.push({ type: 'image_url', image_url: { url: dataUrl } });
                    } else {
                        fileContext.push({ type: 'file', file_url: { url: dataUrl } });
                    }
                } catch (e) {
                    // ignore individual file errors
                } finally {
                    fs.unlink(file.path, () => {});
                }
            }
        }
        
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

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Emit provider metadata so the client can show "Powered by X" on the
        // thinking panel if it wants. Skipped silently if the model isn't
        // exposed (legacy call shape).
        if (stage1Response && stage1Response.provider && stage1Response.model) {
            try {
                res.write(`data: ${JSON.stringify({ metadata: { provider: stage1Response.provider, model: stage1Response.model } })}\n\n`);
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
                    res.write(`data: ${JSON.stringify({ reasoning: item.text })}\n\n`);
                } else {
                    stage1Raw += item.text;
                    res.write(`data: ${JSON.stringify({ chunk: item.text })}\n\n`);
                }
            } else if (typeof item === 'string') {
                stage1Raw += item;
                res.write(`data: ${JSON.stringify({ chunk: item })}\n\n`);
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
            res.write(`data: ${JSON.stringify({ error: 'STAGE1_INVALID: AI output has no slides array' })}\n\n`);
            res.end();
            return;
        }

        const maxSlides = req.body.mode === 'pro' ? 8 : 15;
        if (contentJson.slides.length > maxSlides) {
            contentJson.slides = contentJson.slides.slice(0, maxSlides);
            contentJson.slide_count = maxSlides;
        }

        res.write(`data: ${JSON.stringify({ done: true, skeleton: contentJson })}\n\n`);
        res.end();
    } catch (err) {
        log.error(ErrorCategory.PIPELINE, 'Failed to generate skeleton', { requestId, error: err.message });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to generate outline. Please try again.' });
        } else {
            try {
                res.write(`data: ${JSON.stringify({ error: 'Failed to generate outline. Please try again.' })}\n\n`);
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
            return res.status(400).json({ error: 'Invalid item type' });
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
        res.status(500).json({ error: 'Failed to generate item. Please try again.' });
    }
});

app.post('/generate', upload.array('files', 5), express.json({ limit: '50kb' }), checkGenerationPressure, checkRateLimits, async (req, res) => {
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
                return res.status(400).json({ error: 'SKELETON_EMPTY: The outline has no slides. Please add at least one slide before generating.' });
            }
            const skeletonSlides = opciones.skeleton.slides;
            if (!Array.isArray(skeletonSlides) || skeletonSlides.length === 0) {
                return res.status(400).json({ error: 'SKELETON_EMPTY: The outline has no slides. Please add at least one slide before generating.' });
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
            return res.status(400).json({ error: `Invalid topic: ${sanitizeResult.reason}` });
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

        if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY) {
            log.error(ErrorCategory.CONFIG, 'Generation blocked: OpenRouter/Gemini key missing', {
                requestId
            });
            return res.status(500).json({ error: 'API Key is not configured in .env' });
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
        let fileContext = null;

        if (req.files && req.files.length > 0) {
            fileContext = [];

            // MIME type map — multer may report 'application/octet-stream' for some
            // file types, which Gemini's API would reject. Resolve from extension instead.
            const MIME_BY_EXT = {
                '.pdf':  'application/pdf',
                '.doc':  'application/msword',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                '.png':  'image/png',
                '.jpg':  'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp'
            };

            for (const file of req.files) {
                try {
                    const ext = path.extname(file.originalname).toLowerCase();
                    const mimeType = MIME_BY_EXT[ext] || file.mimetype;

                    // Extract text from DOCX/DOC via mammoth (text works across all providers)
                    if (ext === '.docx' || ext === '.doc') {
                        const extracted = await mammoth.extractRawText({ path: file.path });
                        fileContext.push({
                            type: 'text',
                            text: `Content from ${file.originalname}:\n\n${extracted.value}`
                        });
                        log.info(ErrorCategory.PIPELINE, 'Extracted DOCX as text via mammoth', {
                            requestId,
                            file: file.originalname,
                            chars: extracted.value.length
                        });
                        continue;
                    }

                    const fileData = fs.readFileSync(file.path);
                    const base64Data = fileData.toString('base64');
                    const dataUrl = `data:${mimeType};base64,${base64Data}`;

                    if (mimeType.startsWith('image/')) {
                        fileContext.push({
                            type: 'image_url',
                            image_url: { url: dataUrl }
                        });
                    } else {
                        // For PDFs: Gemini supports inlineData with application/pdf
                        // OpenRouter uses 'file' type — the dataUrl format works for both
                        fileContext.push({
                            type: 'file',
                            file_url: { url: dataUrl }
                        });
                    }
                    log.info(ErrorCategory.PIPELINE, 'File encoded as base64', {
                        requestId,
                        file: file.originalname,
                        mimeType,
                        sizeKB: Math.round(fileData.length / 1024)
                    });
                } catch (e) {
                    log.warn(ErrorCategory.FILESYSTEM, 'Failed to read uploaded file', {
                        requestId,
                        file: file.originalname,
                        error: e.message
                    });
                } finally {
                    fs.unlink(file.path, () => { });
                }
            }
            log.info(ErrorCategory.PIPELINE, 'File context ready for generation', { requestId, count: fileContext.length });
        }

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
                    if (!cancelled) {
                        const stageNames = { stage1: 'content', stage2: 'design', stage3: 'compositing' };
                        res.write(`data: ${JSON.stringify({ pipeline: true, stage: stageNames[stage] || stage, ...data })}\n\n`);
                    }
                },
                onChunk: (item) => {
                    // Forward Stage 1/2 reasoning tokens to the client.
                    // Stage 3 reasoning is forwarded inside consumeModelStream
                    // so we don't double-emit here.
                    if (!cancelled && item && item.type === 'reasoning' && item.stage !== 'stage3') {
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

        // 6.6 Fetch & inject remote photos into img-slot divs (graceful fallback)
        finalHtml = await fetchImages(finalHtml);

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
            error.message.startsWith('CONTENT_REJECTED')
        );
        const isFlashNoCss = error.message && error.message.startsWith('FLASH_NO_DESIGN_CSS');

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
        } else if (isFlashNoCss) {
            // Flash mode's retry loop exhausted (3 attempts × 503-retry + OpenRouter
            // fallback) and every attempt returned HTML without design CSS. The model
            // is up but consistently misformatting — give the user actionable advice.
            userMessage = 'The AI could not produce a valid design after several attempts. Please rephrase your topic with a bit more detail, or switch to Pro mode for better formatting.';
            log.error(ErrorCategory.PIPELINE, 'Flash generation exhausted retries without design CSS', {
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
            // Do NOT delete the file here — the auto-delete timer (10 min) handles cleanup.
            // Deleting immediately causes a 404 on any second request (retry, double-click,
            // browser pre-fetch) even though the file was delivered successfully.
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
