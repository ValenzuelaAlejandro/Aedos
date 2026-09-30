/**
 * Create the security response headers middleware.
 *
 * @returns {any}
 */
function createSecurityHeadersMiddleware() {
    return function(req, res, next) {
        if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        res.setHeader(
            'Content-Security-Policy',
            [
                "default-src 'self'",
                "script-src 'self' https://unpkg.com https://cdnjs.cloudflare.com",
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
                "font-src 'self' https://fonts.gstatic.com",
                "img-src 'self' data: blob: https:",
                "connect-src 'self' https://unpkg.com",
                "frame-src 'self'",
                "worker-src 'none'",
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                "frame-ancestors 'self'"
            ].join('; ')
        );
        next();
    };
}

module.exports = { createSecurityHeadersMiddleware };
