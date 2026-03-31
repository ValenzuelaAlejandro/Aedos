require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const buildPrompt = require('./prompts/base');

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

function processQueue() {
    if (activeGenerations < 3 && queue.length > 0) {
        const { resolve } = queue.shift();
        activeGenerations++;
        resolve();
    }
}

// Rate Limiters
const genLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'RATE_LIMIT_EXCEEDED' }
});

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
    
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('[FATAL] GEMINI_API_KEY must be set.');
    }

    console.log('[BOOT] Environment validation:');
    checks.forEach(({ key, value, fallback }) => {
        const val = value || fallback;
        const symbol = value ? '✓' : '⚠';
        console.log(`  ${symbol} ${key}: ${val}${!value ? ' (using default)' : ''}`);
    });
    console.log('  ✓ API key: present');
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

// Models tried in order — each has its own independent free-tier quota
const MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-pro"
];

const SAFETY = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

async function tryModels(prompt) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    for (const modelName of MODELS) {
        console.log(`[${new Date().toLocaleTimeString()}] Trying: ${modelName}`);
        try {
            const gemini = genAI.getGenerativeModel({ model: modelName, safetySettings: SAFETY });
            const result = await gemini.generateContentStream(prompt);
            if (result && result.response) result.response.catch(() => { });
            console.log(`[${new Date().toLocaleTimeString()}] OK: ${modelName}`);
            return result;
        } catch (err) {
            const msg = err.message || '';
            const isQuota = msg.includes('429') || msg.toLowerCase().includes('quota');
            const is404 = msg.includes('404');
            if (isQuota) { console.warn(`   Quota exhausted for ${modelName}, trying next...`); continue; }
            if (is404) { console.warn(`   Model unavailable: ${modelName}, trying next...`); continue; }
            throw err;
        }
    }
    throw new Error('QUOTA_EXHAUSTED');
}


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

app.post('/generate', express.json({ limit: '8kb' }), genLimiter, async (req, res) => {
    let cancelled = false;
    let completed = false;

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

        const slidesNum = req.body.slides !== undefined ? parseInt(req.body.slides, 10) : 5;
        if (isNaN(slidesNum) || slidesNum < 1 || slidesNum > 15) {
            return res.status(422).json({
                error: 'Validation failed',
                fields: { slides: 'must be integer between 1 and 15' }
            });
        }

        const VALID_IDIOMAS = ['es', 'en', 'fr', 'pt', 'de'];
        const idiomaVal = req.body.idioma || 'es';
        if (!VALID_IDIOMAS.includes(idiomaVal)) {
            return res.status(422).json({
                error: 'Validation failed',
                fields: { idioma: 'must be one of: es, en, fr, pt, de' }
            });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: 'Gemini API Key is not configured in .env' });
        }

        const prompt = buildPrompt(opciones);

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Manage Entry to the Queue
        if (activeGenerations >= 3) {
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


        const result = await tryModels(prompt);

        let fullHtml = '';
        let hasStartedValidContent = false;
        try {
            for await (const chunk of result.stream) {
                if (cancelled) {
                    console.log('Generation manually stopped: client disconnected.');
                    break;
                }
                let chunkText = "";
                try {
                    // Only try to get text if candidates exist and have content
                    if (chunk.candidates && chunk.candidates[0].content && chunk.candidates[0].content.parts[0].text) {
                        chunkText = chunk.text();
                    }
                } catch (e) {
                    console.warn("Skipping non-text chunk or empty part");
                    continue;
                }

                if (!chunkText) continue;

                fullHtml += chunkText;

                let cleanChunk = chunkText.replace(/```html\n?/g, '').replace(/```\n?/g, '');
                // Strip any Google Fonts <link> tags from individual SSE chunks.
                // The browser's HTML parser fires network requests the moment a <link> tag
                // is written via doc.write(), before any JS can sanitize the DOM. Removing
                // them here (server side, per chunk) prevents the request entirely.
                // Handles both complete tags and partial tags split at a chunk boundary.
                cleanChunk = cleanChunk.replace(/<link[^>]*fonts\.googleapis\.com[^>]*\/?>/gi, '');
                cleanChunk = cleanChunk.replace(/<link\b[^>]*fonts\.googleapis\.com[^>]*/gi, '');

                if (!hasStartedValidContent) {
                    const matchIdx = fullHtml.indexOf('<!-- CONFIG');
                    const htmlIdx = fullHtml.indexOf('<html');

                    if (matchIdx !== -1) {
                        hasStartedValidContent = true;
                        const validContentStart = fullHtml.substring(matchIdx);
                        cleanChunk = validContentStart.replace(/```html\n?/g, '').replace(/```\n?/g, '');
                        res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
                    } else if (htmlIdx !== -1) {
                        hasStartedValidContent = true;
                        const validContentStart = fullHtml.substring(htmlIdx);
                        cleanChunk = validContentStart.replace(/```html\n?/g, '').replace(/```\n?/g, '');
                        res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
                    } else if (fullHtml.length > 500) {
                        // Fallback just in case we never find CONFIG or html tag early on
                        hasStartedValidContent = true;
                        cleanChunk = fullHtml.replace(/```html\n?/g, '').replace(/```\n?/g, '');
                        res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
                    }
                } else {
                    res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
                }
            }

        } catch (streamErr) {
            const isParseError = streamErr.message && streamErr.message.includes('parse stream');
            if (isParseError && fullHtml.length > 200) {
                // Stream ended abruptly but we have usable content — treat as a clean finish
                console.warn(`Stream parse error recovered — processing ${fullHtml.length} chars received so far`);
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

            // Safety net: hard cap at 15 slides — strip any section.s beyond the 15th
            const MAX_SLIDES = 15;
            const slideTagRe = /<section[^>]*\bclass="[^"]*\bs\b[^"]*"[^>]*>/gi;
            const slideMatches = [...cleanedOutput.matchAll(slideTagRe)];
            if (slideMatches.length > MAX_SLIDES) {
                const cutIndex = slideMatches[MAX_SLIDES].index;
                // Find where the </body> starts so we can reattach it
                const bodyClose = cleanedOutput.lastIndexOf('</body>');
                const scripts = bodyClose !== -1 ? cleanedOutput.slice(bodyClose) : '</body></html>';
                cleanedOutput = cleanedOutput.slice(0, cutIndex) + '\n' + scripts;
                console.log(`Sanitizer: trimmed presentation from ${slideMatches.length} to ${MAX_SLIDES} slides`);
            }

            // Safety net: fix @import placed as raw text outside <style>
            // The AI sometimes puts @import between <link> tags instead of inside <style>.
            const looseImportRe = />[ \t\n]*(@import\s+url\([^)]+\);)[ \t\n]*</;
            const looseImport = cleanedOutput.match(looseImportRe);
            if (looseImport) {
                const importLine = looseImport[1];
                cleanedOutput = cleanedOutput.replace(/[ \t\n]*@import\s+url\([^)]+\);[ \t\n]*/gi, '\n');
                cleanedOutput = cleanedOutput.replace(/<style>/i, '<style>\n    ' + importLine);
                console.log('Sanitizer: moved loose @import into <style> block');
            }

            // Server-side HTML sanitization: strip scripts/handlers injected by the AI
            // before we inject our own known-safe resources below.
            cleanedOutput = sanitizeGeneratedHtml(cleanedOutput);

            const lucideSrc = 'https://unpkg.com/lucide@0.577.0/dist/umd/lucide.js';
            const fontsLink = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Serif:wght@600;700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root {
    --font-display: 'Syne', sans-serif;
    --font-body: 'DM Sans', sans-serif;
  }
  /* Layering fix: Ensure all primary content elements are positioned so Z-INDEX works. */
  section.s > *, .card, .flex-row, .grid-2, .grid-3, h1, h2, h3, p, .tag, .img-slot { 
    position: relative; 
    z-index: 1; 
  }
</style>`;
            
            // 1. Ensure Lucide library is present
            if (!cleanedOutput.includes(lucideSrc)) {
                if (cleanedOutput.includes('</head>')) {
                    cleanedOutput = cleanedOutput.replace(/<\/head>/i, `${fontsLink}\n<script src="${lucideSrc}"></script>\n</head>`);
                } else if (cleanedOutput.includes('<head>')) {
                    cleanedOutput = cleanedOutput.replace(/<head>/i, `<head>\n${fontsLink}\n<script src="${lucideSrc}"></script>`);
                } else {
                    // Prepend if no head found
                    cleanedOutput = fontsLink + `\n<script src="${lucideSrc}"></script>\n` + cleanedOutput;
                }
                console.log(`[${new Date().toLocaleTimeString()}] Sanitizer: injected fonts and Lucide`);
            } else if (!cleanedOutput.includes('family=Archivo+Black')) {
                // Lucide present but fonts missing
                if (cleanedOutput.includes('<head>')) {
                    cleanedOutput = cleanedOutput.replace(/<head>/i, `<head>\n${fontsLink}`);
                } else {
                    cleanedOutput = fontsLink + cleanedOutput;
                }
                console.log(`[${new Date().toLocaleTimeString()}] Sanitizer: injected fonts link`);
            }

            // 2. Ensure lucide.createIcons() call is present (via external script, no inline needed)
            if (!cleanedOutput.includes('lucide-init.js') && !cleanedOutput.includes('lucide.createIcons')) {
                const call = '<script src="/features/shared/lucide-init.js"></script>';
                if (cleanedOutput.includes('</body>')) {
                    cleanedOutput = cleanedOutput.replace(/<\/body>/i, `${call}\n</body>`);
                } else {
                    cleanedOutput = cleanedOutput + `\n${call}`;
                }
                console.log('Sanitizer: injected lucide-init.js');
            }

            // 3. Ensure DOCTYPE remains at the start
            if (!cleanedOutput.trim().toLowerCase().startsWith('<!doctype html')) {
                cleanedOutput = '<!DOCTYPE html>\n' + cleanedOutput;
            }

            res.write(`data: ${JSON.stringify({ done: true, html: cleanedOutput })}\n\n`);
        }
        // 8. Save debug copy for HTML structure inspection (saving the cleaned version)


        completed = true;
        res.end();

    } catch (error) {
        const isQuotaError = error.message === 'QUOTA_EXHAUSTED';
        const userMessage = isQuotaError
            ? 'The AI service has reached its usage limit. Please try again in a few minutes.'
            : 'Something went wrong. Please try again.';

        if (isQuotaError) console.warn('All models quota exhausted.');
        else console.error('Error generating the presentation:', error);

        if (!res.headersSent) {
            res.status(isQuotaError ? 429 : 500).json({ error: userMessage });
        } else {
            res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
            res.end();
        }
    } finally {
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
                    'div.stat-box', 'div.card', 'div.step-item', 'div.timeline-item',
                    '.stat-grid', '.grid-2', '.grid-3', '.flex-col', '.flex-row',
                    '.quote-block', 'blockquote', 'ul', 'ol',
                    '[class*="card"]', '[class*="box"]'
                ].join(',');
                const TEXT = 'h1,h2,h3,h4,p,span,li,cite,.big-number,.big-label,.tag';
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
                fs.unlink(pdfPath, () => {});
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
    app.listen(PORT, () => {
        console.log(`Eidoslab running at http://localhost:${PORT}`);
    });
}

module.exports = { sanitizeTema, buildPrompt };
