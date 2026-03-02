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

// Gemini API Configuration
let model = null;
if (process.env.GEMINI_API_KEY) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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

app.post('/generate', async (req, res) => {
    try {
        const opciones = req.body;

        // Normalize General Data fields
        opciones.institution = opciones.institution || '';
        opciones.members = opciones.members || '';
        opciones.teacher = opciones.teacher || '';
        opciones.date = opciones.date || '';

        // 1. Validate "tema" is not empty
        if (!opciones.tema || String(opciones.tema).trim() === '') {
            return res.status(400).json({ error: 'The topic is required' });
        }

        // 2. Validate numSlides is between 5 and 15
        const numSlides = parseInt(opciones.numSlides);
        if (isNaN(numSlides) || numSlides < 5 || numSlides > 15) {
            return res.status(400).json({ error: 'The number of slides must be between 5 and 15' });
        }

        if (!model) {
            return res.status(500).json({ error: 'Gemini API Key is not configured in .env' });
        }

        // 4. Call buildPrompt to get the final prompt
        const prompt = buildPrompt(opciones);

        // 5. Call Gemini with fallback models
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const modelNames = [
            "gemini-2.5-flash"
        ];
        let result = null;
        let lastError = null;

        let selectedModel = '';


        for (const modelName of modelNames) {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[${timestamp}] Intentando generacion con: ${modelName}`);

            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const currentModel = genAI.getGenerativeModel({
                model: modelName,
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            });


            let retries = 2;
            let success = false;

            while (retries > 0) {
                try {
                    // Implementación de un timeout manual para la conexión inicial
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout

                    result = await currentModel.generateContentStream(prompt);
                    clearTimeout(timeoutId);

                    if (result && result.response) {
                        result.response.catch(() => { });
                    }
                    success = true;
                    selectedModel = modelName;
                    break;
                } catch (err) {
                    lastError = err;
                    const msg = err.message || '';
                    const is429 = msg.includes('429') || msg.toLowerCase().includes('quota');
                    const is503 = msg.includes('503') || msg.toLowerCase().includes('overloaded');
                    const is404 = msg.includes('404');
                    const isTimeout = err.name === 'AbortError' || msg.includes('deadline');

                    console.error(`   Error en ${modelName}: [${err.name}] ${msg.substring(0, 100)}${msg.length > 100 ? '...' : ''}`);

                    if (is429) console.warn(`   -> Razon: Limite de cuota excedido (Rate Limit).`);
                    else if (is503) console.warn(`   -> Razon: Servidores de Google sobrecargados.`);
                    else if (isTimeout) console.warn(`   -> Razon: Tiempo de espera agotado (Timeout).`);
                    else if (is404) console.warn(`   -> Razon: Modelo no encontrado o no disponible.`);
                    else console.warn(`   -> Razon: Error desconocido/critico.`);

                    if (is429 || is503 || isTimeout) {
                        retries--;
                        if (retries > 0) {
                            const wait = 3000;
                            console.log(`   -> Reintentando en ${wait / 1000}s... (${retries} intentos restantes)`);
                            await new Promise(r => setTimeout(r, wait));
                        }
                    } else {
                        retries = 0; // Si es 404 o error de prompt, no reintentar
                    }
                }
            }
            if (success) {
                console.log(`[${new Date().toLocaleTimeString()}] Exito con el modelo: ${selectedModel}`);
                break;
            }
        }

        if (!result) {
            throw lastError || new Error('All models failed to generate content');
        }

        let fullHtml = '';
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
                res.write(`data: ${JSON.stringify({ chunk: cleanChunk })}\n\n`);
            }

        } catch (streamErr) {
            console.error('Error streaming the presentation:', streamErr);
            res.write(`data: ${JSON.stringify({ error: streamErr.message })}\n\n`);
            res.end();
            return;
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
            res.write(`data: ${JSON.stringify({ done: true, html: cleanedOutput })}\n\n`);
        }
        res.end();

        // 8. Save debug copy for HTML structure inspection
        fs.writeFileSync(path.join(TMP_DIR, 'last_generated.html'), finalHtml);
        console.log('Debug: HTML saved to tmp/last_generated.html');

    } catch (error) {
        if (!res.headersSent) {
            console.error('Error generating the presentation:', error);
            res.status(500).json({ error: 'Internal error generating the presentation: ' + (error.message || error) });
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message || error })}\n\n`);
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
