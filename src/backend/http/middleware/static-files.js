const express = require('express');
const path = require('path');

/**
 * Create the frontend static-file middleware.
 *
 * @param {{frontendDir: string, isDevelopment: boolean}} deps
 * @returns {any}
 */
function createStaticFilesMiddleware({ frontendDir, isDevelopment }) {
    return express.static(frontendDir || path.join(__dirname, '..', '..', '..', 'frontend'), {
        setHeaders: (res, filePath) => {
            const lowerPath = String(filePath || '').toLowerCase();
            const shouldDisableCache = isDevelopment || lowerPath.endsWith('.html');
            if (!shouldDisableCache) return;

            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
    });
}

module.exports = { createStaticFilesMiddleware };
