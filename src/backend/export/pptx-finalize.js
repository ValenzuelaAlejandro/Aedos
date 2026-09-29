const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Finalize the editable PowerPoint response. The Express route, middleware
 * order and queue lifecycle remain owned by server.js.
 */
function createPptxFinalizer({
    tmpDir,
    maxExportHtmlBytes,
    downloadTtlMs,
    renderEditablePptx,
    log,
    ErrorCategory
}) {
    async function finalizePptx(req, res, requestId) {
        const { html, title } = req.body || {};
        if (!html || typeof html !== 'string') return res.status(400).json({ error: 'HTML content is required' });
        if (html.length > maxExportHtmlBytes) return res.status(400).json({ error: 'Payload too large' });

        const pptxFilename = `pptx_${crypto.randomBytes(16).toString('hex')}.pptx`;
        const pptxPath = path.join(tmpDir, pptxFilename);
        const pptxBuffer = await renderEditablePptx(html, title, requestId, { debug: req.query.debug === '1' });
        fs.writeFileSync(pptxPath, pptxBuffer);

        const safeTitlePattern = new RegExp('[\\\\/?%*:|<|>]', 'g');
        const safeTitle = title ? title.replace(safeTitlePattern, '-').trim() : 'Presentacion';
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
        }, downloadTtlMs);
    }

    return { finalizePptx };
}

module.exports = { createPptxFinalizer };
