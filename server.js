require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { runPipeline, buildLegacyPrompt } = require('./prompts/pipeline');
const buildPrompt = require('./prompts/base'); // kept for fallback

const rateLimit = require('express-rate-limit');

const app = express();
// Remove server fingerprint header
app.disable('x-powered-by');
// Trust Render's proxy to get real client IPs for rate limiting
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const TMP_DIR = path.join(__dirname, 'tmp');

// Queue System State
let activeGenerations = 0;
const queue = [];

// OpenRouter model list — comma-separated in env var OPENROUTER_MODEL_LIST
// or single model via OPENROUTER_MODEL. Defaults to qwen free-tier.
const OPENROUTER_MODEL_LIST = (process.env.OPENROUTER_MODEL_LIST || process.env.OPENROUTER_MODEL || 'minimax/minimax-m2.7')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

function processQueue() {
    if (activeGenerations < 10 && queue.length > 0) {
        const { resolve } = queue.shift();
        activeGenerations++;
        resolve();
    }
}

const flashLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 5,
    message: { error: 'DAILY_LIMIT_EXCEEDED_FLASH' }
});

const proLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 3,
    message: { error: 'DAILY_LIMIT_EXCEEDED_PRO' }
});

const checkDailyLimits = (req, res, next) => {
    if (req.body.mode === 'pro') {
        proLimiter(req, res, next);
    } else {
        flashLimiter(req, res, next);
    }
};

const finalizeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'RATE_LIMIT_EXCEEDED' }
});

// CORS Configuration
function buildCorsOptions() {
    const env = process.env.NODE_ENV || 'development';
    const rawOrigins = process.env.ALLOWED_ORIGINS || '';

    let allowedOrigins = [];

    if (env === 'production') {
        if (!rawOrigins) {
            throw new Error(
                '[FATAL] ALLOWED_ORIGINS environment variable is required in production.\n' +
                'Example: ALLOWED_ORIGINS=https://eidoslab.app,https://www.eidoslab.app'
            );
        }
        allowedOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean);

        // Validate each origin
        for (const origin of allowedOrigins) {
            if (!origin.startsWith('https://') || origin.endsWith('/') || origin.includes('*')) {
                throw new Error(
                    `[FATAL] Invalid origin in ALLOWED_ORIGINS: "${origin}"\n` +
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
        console.warn('[CORS WARNING] Using development fallback origins. Set ALLOWED_ORIGINS in .env for production.');
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
            console.warn(`[CORS REJECTED] origin: ${origin}`);
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

    if (!process.env.GEMINI_API_KEY && !(process.env.GEMINI_API_KEY_1 && process.env.GEMINI_API_KEY_2 && process.env.GEMINI_API_KEY_3)) {
        throw new Error('[FATAL] Set either GEMINI_API_KEY or all three of GEMINI_API_KEY_1/2/3.');
    }

    console.log('[BOOT] Environment validation:');
    checks.forEach(({ key, value, fallback }) => {
        const val = value || fallback;
        const symbol = value ? '✓' : '⚠';
        console.log(`  ${symbol} ${key}: ${val}${!value ? ' (using default)' : ''}`);
    });
    console.log('  ✓ API key: present');
    if (process.env.OPENROUTER_API_KEY) {
        console.log(`  ✓ OPENROUTER_API_KEY: present (models: ${OPENROUTER_MODEL_LIST.join(', ')})`);
    } else {
        console.warn(`  ⚠ OPENROUTER_API_KEY: not set — quota fallback disabled`);
    }
}

validateEnvironment();

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

app.use(express.static('public'));


// Create /tmp/ folder if it doesn't exist
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
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

const SAFETY = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

// Per-stage API keys — each stage gets its own key so quotas are independent.
// Falls back to GEMINI_API_KEY if a stage-specific key is not set.
// Stage 1+2 prefer Gemini 2.5 Flash-Lite; Stage 3 prefers Qwen/OpenRouter.
const KEY1 = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY;
const KEY2 = process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY;
const KEY3 = process.env.GEMINI_API_KEY_3 || process.env.GEMINI_API_KEY;

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
                    yield {
                        candidates: [{ content: { parts: [{ text: content }] } }],
                        text: () => content
                    };
                }
            } catch (_) { /* skip malformed SSE frames */ }
        }
    }
}

async function callOpenRouter(prompt, stageName) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('QUOTA_EXHAUSTED'); // no key → surface original error

    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    // Try each configured OpenRouter model until one responds
    for (const model of OPENROUTER_MODEL_LIST) {
        console.log(`[${new Date().toLocaleTimeString()}] [${stageName}] Trying OpenRouter first → ${model}`);
        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.APP_URL || 'https://eidoslab.app',
                    'X-Title': 'EidosLab'
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: promptText }],
                    stream: true
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.warn(`   [OpenRouter] model ${model} failed: ${response.status} ${errText}`);
                continue;
            }

            console.log(`[${new Date().toLocaleTimeString()}] [${stageName}] OpenRouter OK (${model})`);
            return { stream: openRouterSSEToChunks(response) };
        } catch (err) {
            console.warn(`   [OpenRouter] fetch error for ${model}: ${err.message}`);
            continue;
        }
    }

    throw new Error('QUOTA_EXHAUSTED');
}
// ────────────────────────────────────────────────────────────────────────────

async function callGemini(apiKey, modelList, prompt, stageName) {
    const genAI = new GoogleGenerativeAI(apiKey);
    for (const modelName of modelList) {
        console.log(`[${new Date().toLocaleTimeString()}] [${stageName}] Trying Gemini: ${modelName}`);
        try {
            const gemini = genAI.getGenerativeModel({ 
                model: modelName, 
                safetySettings: SAFETY,
                generationConfig: {
                    maxOutputTokens: 8192,
                    temperature: 0.7
                }
            });
            const result = await gemini.generateContentStream(prompt);
            if (result && result.response) result.response.catch(() => { });
            console.log(`[${new Date().toLocaleTimeString()}] [${stageName}] Gemini OK: ${modelName}`);
            return result;
        } catch (err) {
            const rawMsg = err.message || 'Unknown error';
            const isQuota = rawMsg.includes('429') || rawMsg.toLowerCase().includes('quota');
            const is404 = rawMsg.includes('404') || rawMsg.toLowerCase().includes('not found') || rawMsg.toLowerCase().includes('not available');

            if (isQuota) {
                console.warn(`   [${stageName}] Gemini QUOTA EXHAUSTED for ${modelName}: ${rawMsg}`);
                continue;
            }
            if (is404) {
                console.warn(`   [${stageName}] Gemini MODEL UNAVAILABLE for ${modelName}: ${rawMsg}`);
                continue;
            }
            console.error(`   [${stageName}] Gemini UNKNOWN ERROR for ${modelName}: ${rawMsg}`);
            throw err;
        }
    }
    throw new Error('QUOTA_EXHAUSTED');
}

function makeCallerFn(apiKey, modelList, stageName, preferredProvider = 'openrouter') {
    return async function (prompt) {
        const providerOrder = preferredProvider === 'gemini'
            ? ['gemini', 'openrouter']
            : ['openrouter', 'gemini'];

        let lastError = null;

        for (const provider of providerOrder) {
            try {
                if (provider === 'gemini') {
                    return await callGemini(apiKey, modelList, prompt, stageName);
                }
                return await callOpenRouter(prompt, stageName);
            } catch (err) {
                lastError = err;
                const msg = err?.message || `unknown ${provider} error`;
                console.warn(`   [${stageName}] ${provider} unavailable or exhausted — trying next provider (${msg})`);
            }
        }

        throw lastError || new Error('QUOTA_EXHAUSTED');
    };
}

// Stage routing:
// - Flash (legacy single-prompt): prefer Gemini 2.5 Flash-Lite, fall back to OpenRouter.
// - Stage 1 & 2 (Pro pipeline): prefer Gemini 2.5 Flash-Lite, fall back to OpenRouter.
// - Stage 3 (Pro pipeline HTML compositor): prefer OpenRouter, fall back to Gemini.
const tryModelsFlash = makeCallerFn(KEY1, ['gemini-2.5-flash-lite', 'gemini-2.5-flash'], 'Flash', 'gemini');
const tryModelsStage1 = makeCallerFn(KEY1, ['gemini-2.5-flash-lite', 'gemini-2.5-flash'], 'Stage1', 'gemini');
const tryModelsStage2 = makeCallerFn(KEY2, ['gemini-2.5-flash-lite', 'gemini-2.5-flash'], 'Stage2', 'gemini');
const tryModelsStage3 = makeCallerFn(KEY3, ['gemini-2.5-flash', 'gemini-2.5-flash-lite'], 'Stage3', 'openrouter');

// Legacy alias kept for any remaining references
const tryModels = tryModelsFlash;


// Global Puppeteer Browser Instance
let browser;

async function initBrowser() {
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote'
            ]
        });
    } catch (error) {
        console.error("Error starting Puppeteer:", error);
    }
}
initBrowser();

// Close Puppeteer securely when the server terminates
process.on('SIGINT', async () => {
    if (browser) await browser.close();
    process.exit();
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

app.post('/generate', express.json({ limit: '8kb' }), checkDailyLimits, async (req, res) => {
    let cancelled = false;
    let completed = false;
    let sseKeepAlive = null;

    res.on('close', () => {
        if (!completed) {
            console.log(`[${new Date().toLocaleTimeString()}] Client disconnected — cancelling generation`);
            cancelled = true;
        }
    });

    try {
        const opciones = req.body;

        const rawTema = opciones.tema || '';
        const sanitizeResult = sanitizeTema(String(rawTema));
        if (!sanitizeResult.valid) {
            return res.status(400).json({ error: `Invalid topic: ${sanitizeResult.reason}` });
        }

        opciones.tema = sanitizeResult.tema;

        // Flash mode (single-prompt, default) vs Pro mode (3-stage pipeline)
        const usePipeline = req.body.mode === 'pro';

        let slidesNum = req.body.slides !== undefined ? parseInt(req.body.slides, 10) : 5;
        if (isNaN(slidesNum) || slidesNum < 1 || slidesNum > 15) {
            return res.status(422).json({
                error: 'Validation failed',
                fields: { slides: 'must be integer between 1 and 15' }
            });
        }

        // Cap the actual slides requested to the AI based on the mode
        const slideHardLimit = usePipeline ? 8 : 15;
        if (slidesNum > slideHardLimit) {
            slidesNum = slideHardLimit;
            opciones.slides = slidesNum;
        }

        const VALID_IDIOMAS = ['es', 'en', 'fr', 'pt', 'de'];
        const idiomaVal = req.body.idioma || 'es';
        if (!VALID_IDIOMAS.includes(idiomaVal)) {
            return res.status(422).json({
                error: 'Validation failed',
                fields: { idioma: 'must be one of: es, en, fr, pt, de' }
            });
        }

        if (!process.env.GEMINI_API_KEY && !(process.env.GEMINI_API_KEY_1 && process.env.GEMINI_API_KEY_2 && process.env.GEMINI_API_KEY_3)) {
            return res.status(500).json({ error: 'Gemini API Key is not configured in .env' });
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Keep the SSE stream alive during slow model responses so the browser/proxy
        // does not assume the request stalled while OpenRouter is still generating.
        sseKeepAlive = setInterval(() => {
            if (!completed && !cancelled && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({ heartbeat: true })}\n\n`);
            }
        }, 25000);

        // Manage Entry to the Queue
        if (activeGenerations >= 10) {
            res.write(`data: ${JSON.stringify({ queued: true, position: queue.length + 1 })}\n\n`);
            await new Promise((resolve) => {
                const item = { resolve };
                queue.push(item);
                req.on('close', () => {
                    const idx = queue.indexOf(item);
                    if (idx !== -1) queue.splice(idx, 1);
                });
            });
            res.write(`data: ${JSON.stringify({ queued: false })}\n\n`);
        } else {
            activeGenerations++;
        }

        // ────────────────────────────────────────────────
        // Choose generation path: Flash (single-prompt) or Pro (3-stage pipeline)
        // ────────────────────────────────────────────────
        let result;
        if (!usePipeline) {
            // Flash mode — single-prompt path (default)
            const prompt = buildPrompt(opciones);
            result = await tryModels(prompt);
        } else {
            // Pro mode — 3-Stage Pipeline: Content → Design → HTML
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

            if (cancelled) { res.end(); return; }

            result = pipelineResult.stage3Stream;
            console.log(`[Pipeline] Stage 3 stream ready — beginning HTML streaming to client`);
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
                    console.log('Generation manually stopped: client disconnected.');
                    break;
                }
                let chunkText = "";
                try {
                    if (chunk.candidates && chunk.candidates[0].content && chunk.candidates[0].content.parts[0].text) {
                        chunkText = chunk.text();
                    }
                } catch (e) {
                    console.warn("Skipping non-text chunk or empty part");
                    continue;
                }

                if (!chunkText) continue;

                // Stop AI hallucination: If we detect more slides than allowed, kill the stream immediately to save tokens.
                const matches = chunkText.match(slideTagRegex);
                if (matches) {
                    streamSlideCount += matches.length;
                    if (streamSlideCount > slideHardLimit) {
                        console.warn(`[Pipeline] AI attempted to exceed ${slideHardLimit} slides. Terminating stream mid-generation to save tokens.`);
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
                    console.warn(`Stream parse error recovered — processing ${fullHtml.length} chars (CSS present)`);
                } else {
                    console.warn(`Stream parse error: no design CSS found in ${fullHtml.length} chars — aborting`);
                    res.write(`data: ${JSON.stringify({ error: 'Stream ended before CSS was generated. Please try again.' })}\n\n`);
                    res.end();
                    return;
                }
            } else {
                console.error('Error streaming the presentation:', streamErr);
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
                console.log(`Sanitizer: trimmed presentation from ${slideMatches.length} to ${MAX_SLIDES} slides`);
            }

            // Safety net: strip overflow-y:auto/scroll from inner containers.
            // Slides are static — scrollable inner regions produce invisible hidden content.
            // Replace with overflow:hidden so the AI's scale-down rules apply instead.
            const overflowScrollRe = /\boverflow-y\s*:\s*(auto|scroll)\b/gi;
            const overflowShorthandRe = /\boverflow\s*:\s*(auto|scroll)\b/gi;
            if (overflowScrollRe.test(cleanedOutput) || overflowShorthandRe.test(cleanedOutput)) {
                cleanedOutput = cleanedOutput.replace(/\boverflow-y\s*:\s*(auto|scroll)\b/gi, 'overflow-y:hidden');
                cleanedOutput = cleanedOutput.replace(/\boverflow\s*:\s*(auto|scroll)\b/gi, 'overflow:hidden');
                console.log('Sanitizer: stripped overflow-y:auto/scroll → overflow:hidden');
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
                console.log('Sanitizer: moved loose @import into <style> block');
            }

            // Guard: reject HTML without design CSS
            const hasDesignCss = /<style[\s\S]*?section\.s[\s\S]*?<\/style>/i.test(cleanedOutput)
                || /<style[\s\S]*?--bg[\s\S]*?<\/style>/i.test(cleanedOutput);
            if (!hasDesignCss) {
                console.warn(`[${new Date().toLocaleTimeString()}] Sanitizer: AI output has no design CSS — rejecting (length: ${cleanedOutput.length})`);
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
            // 1. Ensure Lucide library is present
            if (!cleanedOutput.includes(lucideSrc)) {
                if (cleanedOutput.includes('</head>')) {
                    cleanedOutput = cleanedOutput.replace(/<\/head>/i, `<script src="${lucideSrc}" integrity="${lucideIntegrity}" crossorigin="anonymous"></script>\n</head>`);
                } else if (cleanedOutput.includes('<head>')) {
                    cleanedOutput = cleanedOutput.replace(/<head>/i, `<head>\n<script src="${lucideSrc}" integrity="${lucideIntegrity}" crossorigin="anonymous"></script>`);
                } else {
                    cleanedOutput = `<script src="${lucideSrc}" integrity="${lucideIntegrity}" crossorigin="anonymous"></script>\n` + cleanedOutput;
                }
                console.log(`[${new Date().toLocaleTimeString()}] Sanitizer: injected Lucide library`);
            }

            // 2. Ensure lucide.createIcons() call is present
            if (!cleanedOutput.includes('lucide-init.js') && !cleanedOutput.includes('lucide.createIcons')) {
                const call = '<script src="/features/shared/lucide-init.js"></script>';
                if (cleanedOutput.includes('</body>')) {
                    cleanedOutput = cleanedOutput.replace(/<\/body>/i, `${call}\n</body>`);
                } else {
                    cleanedOutput = cleanedOutput + `\n${call}`;
                }
                console.log('Sanitizer: injected lucide-init.js');
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
                console.log(`Sanitizer: added safety closers: ${safetyCloser}`);
            }

            // 4. Ensure DOCTYPE remains at the start
            if (!cleanedOutput.trim().toLowerCase().startsWith('<!doctype html')) {
                cleanedOutput = '<!DOCTYPE html>\n' + cleanedOutput;
            }

            // 4. Dev-only: save generated HTML to tmp/ for easier debugging
            if ((process.env.NODE_ENV || 'development') !== 'production') {
                const debugPath = path.join(TMP_DIR, 'last_generated.html');
                fs.writeFile(debugPath, cleanedOutput, 'utf8', (err) => {
                    if (err) console.warn('[DEV] Failed to save debug HTML:', err.message);
                    else console.log(`[DEV] Saved generated HTML → ${debugPath}`);
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
            console.warn('All models quota exhausted.');
        } else if (isPipelineError) {
            userMessage = 'The AI had trouble understanding the request. Please try rephrasing or adding more detail.';
            console.error('Pipeline error:', error.message);
        } else {
            userMessage = 'Something went wrong. Please try again.';
            console.error('Error generating the presentation:', error);
        }

        if (!res.headersSent) {
            res.status(isQuotaError ? 429 : 500).json({ error: userMessage });
        } else {
            res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
            res.end();
        }
    } finally {
        if (sseKeepAlive) clearInterval(sseKeepAlive);
        activeGenerations--;
        processQueue();
    }
});

// Finalize: receive (possibly modified) HTML, convert to PDF
app.post('/finalize', express.json({ limit: '50mb' }), finalizeLimiter, async (req, res) => {
    try {
        const { html, title } = req.body;

        if (!html || typeof html !== 'string') {
            return res.status(400).json({ error: 'HTML content is required' });
        }
        if (html.length > 2 * 1024 * 1024) { // 2MB
            return res.status(400).json({ error: 'Payload too large' });
        }

        const timestamp = Date.now();
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
                console.warn('Network did not reach idle before timeout — rendering with available fonts');
            });

            // Step 3: wait for FontFaceSet to confirm fonts are ready after the network settled
            await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {
                console.warn('Font loading check failed (non-fatal)');
            });
            // Wait for Lucide icons to render
            await page.waitForFunction(() => {
                const pendingIcons = document.querySelectorAll('i[data-lucide]');
                return pendingIcons.length === 0;
            }, { timeout: 8000 }).catch(() => {
                console.warn('Lucide icons may not have fully rendered (timeout)');
            });
            // Prevent trailing blank page; also lock big-number against wrapping
            // (font metrics in Puppeteer can differ enough to push '30%' to 2 lines)
            await page.addStyleTag({
                content: `
                    section.s:last-of-type { page-break-after: avoid !important; }
                    body { overflow: hidden; }
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
                    '[data-eidos-container="true"]',
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
                console.warn('Puppeteer-side layout normalization failed (non-fatal)');
            });
            await page.pdf({
                path: pdfPath,
                width: '29.7cm',
                height: '16.7cm',
                printBackground: true,
                margin: { top: 0, right: 0, bottom: 0, left: 0 }
            });
        } finally {
            await page.close();
        }

        const safeTitle = title ? title.replace(/[\/\\?%*:|<|>]/g, '-').trim() : 'Presentacion';
        res.set('Cache-Control', 'no-store');
        res.json({ pdfUrl: `/download/${pdfFilename}?name=${encodeURIComponent(safeTitle)}` });

        setTimeout(() => {
            if (fs.existsSync(pdfPath)) {
                fs.unlink(pdfPath, () => { });
                console.log(`Auto-deleted unclaimed PDF: ${pdfFilename}`);
            }
        }, 10 * 60 * 1000);
    } catch (error) {
        console.error('Error finalizing PDF:', error);
        res.status(500).json({ error: 'Error generating PDF: ' + (error.message || error) });
    }
});

app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;

    // Security: avoid path traversal
    if (filename.includes('/') || filename.includes('..')) {
        return res.status(400).send('Invalid file');
    }

    const filePath = path.join(TMP_DIR, filename);

    // Stop if file doesn't exist
    if (!fs.existsSync(filePath)) {
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
            console.error('Error downloading the file:', err);
        } else {
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting the temporary file:', unlinkErr);
            });
        }
    });
});

if (require.main === module) {
    const server = app.listen(PORT, () => {
        console.log(`Eidoslab running at http://localhost:${PORT}`);
    });

    // Allow long-running AI generations before Node gives up on the request.
    server.requestTimeout = 10 * 60 * 1000;
    server.headersTimeout = 11 * 60 * 1000;
}

module.exports = { sanitizeTema, buildPrompt };
