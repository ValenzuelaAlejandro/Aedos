/* eslint-disable max-lines-per-function */

const express = require('express');
const fs = require('fs');

/**
 * Register PDF and editable PowerPoint finalization endpoints.
 *
 * @param {{app: any, checkFinalizePressure: Function, checkFinalizeLimits: Function, finalizeQueueState: any, pptxFinalizer: any, pdfExporter: any, maxExportHtmlBytes: number, downloadTtlMs: number, log: any, puppeteerLog: any, classifyError: Function, ErrorCategory: any}} deps
 * @returns {void}
 */
function registerFinalizeRoutes({
    app,
    checkFinalizePressure,
    checkFinalizeLimits,
    finalizeQueueState,
    pptxFinalizer,
    pdfExporter,
    maxExportHtmlBytes,
    downloadTtlMs,
    log,
    puppeteerLog,
    classifyError,
    ErrorCategory
}) {
    app.post('/finalize-pptx', express.json({ limit: '50mb' }), checkFinalizePressure, checkFinalizeLimits, async (req, res) => {
        const requestId = req.requestId || 'n/a';
        res.on('error', (err) => {
            puppeteerLog.warn(ErrorCategory.STREAM, 'PowerPoint response stream error (non-fatal)', {
                requestId,
                error: String((err && err.message) || err)
            });
        });

        const obtainedSlot = await finalizeQueueState.enqueue(req, { requestId });
        if (!obtainedSlot) return;

        try {
            await pptxFinalizer.finalizePptx(req, res, requestId);
        } catch (error) {
            log.error(classifyError(error, ErrorCategory.PUPPETEER), 'Failed to finalize editable PowerPoint', {
                requestId,
                error
            });
            const status = error.code === 'CONTRACT_VIOLATION' ? 400 : 500;
            if (!res.headersSent) res.status(status).json({ error: 'Error generating PowerPoint: ' + (error.message || error), tipo: error.code === 'CONTRACT_VIOLATION' ? 'contract-violation' : undefined });
        } finally {
            finalizeQueueState.release();
        }
    });

    app.post('/finalize', express.json({ limit: '50mb' }), checkFinalizePressure, checkFinalizeLimits, async (req, res) => {
        const requestId = req.requestId || 'n/a';
        res.on('error', (err) => {
            puppeteerLog.warn(ErrorCategory.STREAM, 'Finalize response stream error (non-fatal)', {
                requestId,
                error: String((err && err.message) || err)
            });
        });

        const obtainedSlot = await finalizeQueueState.enqueue(req, { requestId, logQueued: true });
        if (!obtainedSlot) return;

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
            if (html.length > maxExportHtmlBytes) {
                log.warn(ErrorCategory.VALIDATION, 'Finalize rejected: payload too large', {
                    requestId,
                    htmlBytes: html.length
                });
                return res.status(400).json({ error: 'Payload too large' });
            }

            const { pdfFilename, pdfPath } = await pdfExporter.renderPdf({ html, title, requestId });
            const safeTitle = title ? title.replace(/[/\\?%*:|<|>]/g, '-').trim() : 'Presentacion';
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
            }, downloadTtlMs);
        } catch (error) {
            log.error(classifyError(error, ErrorCategory.PUPPETEER), 'Failed to finalize PDF', {
                requestId,
                error
            });
            res.status(500).json({ error: 'Error generating PDF: ' + (error.message || error) });
        } finally {
            finalizeQueueState.release();
        }
    });
}

module.exports = { registerFinalizeRoutes };
