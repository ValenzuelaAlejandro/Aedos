const fs = require('fs');
const path = require('path');

/**
 * Register the existing download route without changing its response behavior.
 * @param {{get: Function}} app Express application
 * @param {{tmpDir: string, log: {warn: Function, error: Function, success: Function}, classifyError: Function, ErrorCategory: Record<string, string>}} deps route dependencies
 * @returns {void}
 */
function registerDownloadRoute(app, { tmpDir, log, classifyError, ErrorCategory }) {
    app.get('/download/:filename', (req, res) => {
        const requestId = req.requestId || 'n/a';
        res.on('error', (err) => {
            log.warn(ErrorCategory.DOWNLOAD, 'Download response stream error (non-fatal)', {
                requestId,
                error: String((err && err.message) || err)
            });
        });
        const filename = req.params.filename;
        if (filename.includes('/') || filename.includes('..')) {
            log.warn(ErrorCategory.SECURITY, 'Blocked download path traversal attempt', { requestId, filename });
            return res.status(400).send('Invalid file');
        }
        const filePath = path.join(tmpDir, filename);
        if (!fs.existsSync(filePath)) {
            log.warn(ErrorCategory.DOWNLOAD, 'Download failed: file not found', { requestId, filename });
            return res.status(404).send('File not found');
        }
        res.set('Cache-Control', 'no-store');
        const extension = path.extname(filename).toLowerCase() || '.pdf';
        let downloadName = req.query.name ? req.query.name : filename;
        if (!downloadName.toLowerCase().endsWith(extension)) downloadName += extension;
        res.download(filePath, downloadName, (err) => {
            if (err) {
                log.error(classifyError(err, ErrorCategory.DOWNLOAD), 'Error sending download file', { requestId, filename, error: err });
            } else {
                log.success(ErrorCategory.DOWNLOAD, 'File downloaded successfully', { requestId, filename, downloadName });
            }
        });
    });
}

module.exports = { registerDownloadRoute };
