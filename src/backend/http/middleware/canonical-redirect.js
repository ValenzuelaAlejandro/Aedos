/**
 * Create the production-only Render URL redirect middleware.
 *
 * @returns {any}
 */
function createCanonicalRedirectMiddleware() {
    return function(req, res, next) {
        const host = req.headers.host || '';
        const path = req.path || '';
        const isApiRoute = /^\/(generate|finalize(?:-pptx)?|download|health|__dev__)/.test(path);

        if (host.includes('onrender.com') && !isApiRoute) {
            const target = 'https://aedoslab.xyz' + req.originalUrl;
            return res.redirect(301, target);
        }
        next();
    };
}

module.exports = { createCanonicalRedirectMiddleware };
