require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const buildPrompt = require('./prompts/base');

const app = express();
const PORT = process.env.PORT || 3000;
const TMP_DIR = path.join(__dirname, 'tmp');

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(cors());
app.use(express.static('public'));

// Create /tmp/ folder if it doesn't exist
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
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
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
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

app.get('/debug-last', (req, res) => {
    const debugPath = path.join(TMP_DIR, 'last_generated.html');
    if (fs.existsSync(debugPath)) {
        res.sendFile(debugPath);
    } else {
        res.status(404).send('No file generated yet');
    }
});

app.post('/generate', async (req, res) => {
    try {
        const opciones = req.body;

        // Validate that the chat input is not empty
        if (!opciones.tema || String(opciones.tema).trim() === '') {
            return res.status(400).json({ error: 'The topic is required' });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: 'Gemini API Key is not configured in .env' });
        }

        const prompt = buildPrompt(opciones);

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const result = await tryModels(prompt);

        let fullHtml = '';
        let hasStartedValidContent = false;
        try {
            for await (const chunk of result.stream) {
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

        // 6. Clean the full response
        let finalHtml = fullHtml.replace(/^```html\n?/m, '').replace(/^```\n?/m, '').replace(/```\n?$/m, '').trim();

        // 7. Validate the response — detect refusals
        const configRegex = /<!--\s*CONFIG[\s\S]*?-->/i;
        const configMatch = finalHtml.match(configRegex);
        let contentForCheck = finalHtml.toLowerCase();
        let htmlStartIdx = contentForCheck.indexOf('<html');
        if (htmlStartIdx === -1) htmlStartIdx = contentForCheck.indexOf('<style');

        const looksLikeHtml = htmlStartIdx !== -1;

        if (!looksLikeHtml) {
            res.write(`data: ${JSON.stringify({ refused: true, message: finalHtml })}\n\n`);
        } else {
            // Trim off any conversational garbage Gemini put *before* the first real HTML tag
            let cleanedOutput = finalHtml.substring(finalHtml.indexOf('<', htmlStartIdx));

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

            const lucideSrc = 'https://unpkg.com/lucide@0.469.0/dist/umd/lucide.js';
            const fontsLink = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root {
    --font-display: 'Syne', sans-serif;
    --font-body: 'DM Sans', sans-serif;
  }
</style>`;
            
            if (!cleanedOutput.includes(lucideSrc)) {
                cleanedOutput = cleanedOutput.replace(/<\/head>/i, `${fontsLink}\n<script src="${lucideSrc}"></script>\n</head>`);
                console.log(`[${new Date().toLocaleTimeString()}] Sanitizer: injected fonts and Lucide`);
            } else if (!cleanedOutput.includes('family=Archivo+Black')) {
                if (cleanedOutput.includes('<head>')) {
                    cleanedOutput = cleanedOutput.replace(/<head>/i, `<head>\n${fontsLink}`);
                } else if (cleanedOutput.includes('<html>')) {
                    cleanedOutput = cleanedOutput.replace(/<html>/i, `<html><head>${fontsLink}</head>`);
                } else {
                    cleanedOutput = fontsLink + cleanedOutput;
                }
                console.log(`[${new Date().toLocaleTimeString()}] Sanitizer: injected fonts link (Archivo Black was missing)`);
            }
            // Safety net: if lucide.createIcons() call is missing, inject it before </body>
            if (!cleanedOutput.includes('lucide.createIcons')) {
                cleanedOutput = cleanedOutput.replace(/<\/body>/i, `<script>lucide.createIcons();</script>\n</body>`);
                console.log('Sanitizer: injected missing lucide.createIcons() call');
            }

            res.write(`data: ${JSON.stringify({ done: true, html: cleanedOutput })}\n\n`);
        }
        res.end();

        // 8. Save debug copy for HTML structure inspection
        fs.writeFileSync(path.join(TMP_DIR, 'last_generated.html'), finalHtml);
        console.log('Debug: HTML saved to tmp/last_generated.html');

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
    }
});

// Finalize: receive (possibly modified) HTML, convert to PDF
app.post('/finalize', async (req, res) => {
    try {
        const { html, title } = req.body;

        if (!html || typeof html !== 'string') {
            return res.status(400).json({ error: 'HTML content is required' });
        }

        const timestamp = Date.now();
        const pdfFilename = `slide_${timestamp}.pdf`;
        const pdfPath = path.join(TMP_DIR, pdfFilename);

        // Restart / check browser
        if (!browser || !browser.isConnected()) {
            await initBrowser();
        }

        const page = await browser.newPage();
        try {
            await page.setContent(html, { waitUntil: 'networkidle0' });
            // Wait for Lucide icons to render
            await page.waitForFunction(() => {
                const pendingIcons = document.querySelectorAll('i[data-lucide]');
                return pendingIcons.length === 0;
            }, { timeout: 8000 }).catch(() => {
                console.warn('Lucide icons may not have fully rendered (timeout)');
            });
            // Prevent trailing blank page
            await page.addStyleTag({
                content: `
                    section.s:last-of-type { page-break-after: avoid !important; }
                    body { overflow: hidden; }
                    body > script { display: none; }
                `
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

        const safeTitle = title ? title.replace(/[\/\\?%*:|"<>]/g, '-').trim() : 'Presentacion';
        res.json({ pdfUrl: `/download/${pdfFilename}?name=${encodeURIComponent(safeTitle)}` });

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

app.listen(PORT, () => {
    console.log(`Eidoslab running at http://localhost:${PORT}`);
});
