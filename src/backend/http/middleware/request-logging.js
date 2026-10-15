const { randomUUID } = require('node:crypto');
const { providerRequestContext } = require('../../providers/request-context');
const { spendConfig } = require('../../config/provider-spend');
const { resolveClientIp } = require('../../utils/rate-limiter');

/**
 * Decide whether a request belongs to the server's traced request set.
 *
 * @param {any} req
 * @returns {boolean}
 */
function shouldTraceRequest(req) {
    const target = req.path || req.originalUrl || '';
    return target === '/' ||
        target.startsWith('/health') ||
        target.startsWith('/generate') ||
        target.startsWith('/finalize') ||
        target.startsWith('/download') ||
        target.startsWith('/__dev__');
}

/**
 * Create request ID assignment and completion logging middleware.
 *
 * @param {{log: any, ErrorCategory: any}} deps
 * @returns {any}
 */
function createRequestLoggingMiddleware({ log, ErrorCategory }) {
    return function(req, res, next) {
        const requestId = randomUUID();
        const startedAt = process.hrtime.bigint();
        const startedAtMs = Date.now();
        const clientIp = resolveClientIp(req);
        req.requestId = requestId;
        res.setHeader('X-Request-Id', requestId);

        if (shouldTraceRequest(req)) {
            log.http(ErrorCategory.HTTP, 'Request started', {
                requestId,
                method: req.method,
                path: req.originalUrl,
                ip: clientIp
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
                ip: clientIp
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

        const clientController = new AbortController();
        const deadlineController = new AbortController();
        const requestTimer = setTimeout(() => deadlineController.abort(new Error('REQUEST_TOTAL_TIMEOUT')),
            spendConfig().maxRequestDurationMs);
        requestTimer.unref?.();
        const signal = AbortSignal.any([clientController.signal, deadlineController.signal]);
        const clearRequestTimer = () => clearTimeout(requestTimer);
        res.on('finish', clearRequestTimer);
        res.on('close', () => {
            clearRequestTimer();
            if (!res.writableEnded) clientController.abort(new Error('CLIENT_DISCONNECTED'));
        });
        providerRequestContext.run({ requestId, req, clientIp, startedAt: startedAtMs, signal,
            spendState: { reservedMicroUsd: 0, settledMicroUsd: 0, attemptCount: 0,
                startedAt: startedAtMs, clientIp } }, next);
    };
}

module.exports = { createRequestLoggingMiddleware };
