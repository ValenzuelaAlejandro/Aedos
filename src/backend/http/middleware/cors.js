const cors = require('cors');

/**
 * Create the CORS middleware with the server's existing policy.
 *
 * @param {{log: any, ErrorCategory: any}} deps
 * @returns {any}
 */
function createCorsMiddleware({ log, ErrorCategory }) {
    const env = process.env.NODE_ENV || 'development';
    const rawOrigins = process.env.ALLOWED_ORIGINS || '';
    let allowedOrigins = [];

    if (env === 'production') {
        if (!rawOrigins) {
            throw new Error(
                'ALLOWED_ORIGINS environment variable is required in production.\n' +
                'Example: ALLOWED_ORIGINS=https://aedos.app,https://www.aedos.app'
            );
        }
        allowedOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean);

        for (const origin of allowedOrigins) {
            if (!origin.startsWith('https://') || origin.endsWith('/') || origin.includes('*')) {
                throw new Error(
                    `Invalid origin in ALLOWED_ORIGINS: "${origin}"\n` +
                    'Each origin must start with https://, have no trailing slash, and no wildcards.'
                );
            }
        }
    } else {
        allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:5173',
            'http://127.0.0.1:3000'
        ];
        log.warn(ErrorCategory.CONFIG, 'Using development fallback CORS origins', {
            allowedOrigins
        });
    }

    return cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) return callback(null, true);
            log.warn(ErrorCategory.SECURITY, 'CORS origin rejected', { origin });
            return callback(new Error('Not allowed by CORS'), false);
        },
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false,
        maxAge: 600,
        optionsSuccessStatus: 204
    });
}

module.exports = { createCorsMiddleware };
