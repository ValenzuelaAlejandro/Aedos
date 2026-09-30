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
    let requestSequence = 0;

    return function(req, res, next) {
        requestSequence += 1;
        const requestId = `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
        const startedAt = process.hrtime.bigint();
        req.requestId = requestId;
        res.setHeader('X-Request-Id', requestId);

        if (shouldTraceRequest(req)) {
            log.http(ErrorCategory.HTTP, 'Request started', {
                requestId,
                method: req.method,
                path: req.originalUrl,
                ip: req.ip
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
                ip: req.ip
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

        next();
    };
}

module.exports = { createRequestLoggingMiddleware };
