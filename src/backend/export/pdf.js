/* eslint-disable max-lines-per-function, no-undef */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Render and post-process one PDF export. Route validation and response
 * serialization remain in server.js; this module owns the browser render,
 * dimensions, layout normalization and pdf-lib metadata pass.
 */
function createPdfExporter({
    browserManager,
    tmpDir,
    port,
    puppeteerLog,
    log,
    ErrorCategory
}) {
    async function renderPdf({ html, title, requestId }) {
        const pdfFilename = `pdf_${crypto.randomBytes(16).toString('hex')}.pdf`;
        const pdfPath = path.join(tmpDir, pdfFilename);

        // Restart / check browser
        if (!browserManager.getBrowser() || !browserManager.getBrowser().isConnected()) {
            await browserManager.initBrowser();
        }
        if (!browserManager.getBrowser()) {
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
        const baseTag = `<base href="http://localhost:${port}/">`;
        if (!processedHtml.includes('<base')) {
            processedHtml = processedHtml.replace(/(<head[^>]*>)/i, `$1\n${baseTag}`);
        }
        // Replace animated GIFs with a 1×1 transparent placeholder
        processedHtml = processedHtml
            .replace(/(<img\b[^>]*?)\bsrc\s*=\s*(["'])(?!data:)[^"']*\.gif[^"']*\2/gi,
                `$1src="${TRANSPARENT_GIF}"`)
            .replace(/url\s*\(\s*(["']?)(?!data:)[^)"'\s]*\.gif[^)"'\s]*\1\s*\)/gi,
                `url("${TRANSPARENT_GIF}")`);

        const page = await browserManager.getBrowser().newPage();
        try {
            await page.setContent(processedHtml, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForNetworkIdle({ idleTime: 500, timeout: 12000 }).catch(() => {
                puppeteerLog.warn(ErrorCategory.NETWORK, 'Network did not reach idle before timeout', {
                    requestId
                });
            });

            await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {
                puppeteerLog.warn(ErrorCategory.PUPPETEER, 'Font loading check failed (non-fatal)', {
                    requestId
                });
            });
            await page.waitForFunction(() => {
                const pendingIcons = document.querySelectorAll('i[data-lucide]');
                return pendingIcons.length === 0;
            }, { timeout: 8000 }).catch(() => {
                puppeteerLog.warn(ErrorCategory.PUPPETEER, 'Lucide icons may not have fully rendered (timeout)', {
                    requestId
                });
            });
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
                        /** @type {any} */
                        const styleEl = el;
                        const comp = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        if (!rect.width || !rect.height) return;
                        styleEl.style.setProperty('font-size', comp.fontSize, 'important');
                        styleEl.style.setProperty('line-height', comp.lineHeight, 'important');
                        const lh = parseFloat(comp.lineHeight) || parseFloat(comp.fontSize) * 1.2;
                        if (rect.height <= lh * 1.8) {
                            styleEl.style.setProperty('white-space', 'nowrap', 'important');
                            styleEl.style.setProperty('word-break', 'normal', 'important');
                            styleEl.style.setProperty('overflow-wrap', 'normal', 'important');
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
                timeout: 45000
            });

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

        return { pdfFilename, pdfPath };
    }

    return { renderPdf };
}

module.exports = { createPdfExporter };
