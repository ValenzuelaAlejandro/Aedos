const fs = require('fs');
const path = require('path');

/**
 * Register health, root and development inspection endpoints.
 *
 * @param {{app: any, tmpDir: string}} deps
 * @returns {void}
 */
function registerEntryRoutes({ app, tmpDir }) {
    app.get('/health', (req, res) => {
        res.status(200).send('OK');
    });

    app.get('/', (req, res) => {
        const host = req.headers.host || '';
        if (process.env.NODE_ENV === 'production' && host.includes('onrender.com')) {
            return res.redirect(301, 'https://aedoslab.xyz');
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
        res.sendFile(path.join(__dirname, '..', '..', '..', 'frontend', 'index.html'));
    });

    if ((process.env.NODE_ENV || 'development') !== 'production') {
        app.get('/__dev__/last-generated', (req, res) => {
            const debugPath = path.join(tmpDir, 'last_generated.html');

            if (!fs.existsSync(debugPath)) {
                return res.status(404).json({ error: 'tmp/last_generated.html not found' });
            }

            res.set('Cache-Control', 'no-store');
            res.type('html');
            res.send(fs.readFileSync(debugPath, 'utf8'));
        });
    }
}

module.exports = { registerEntryRoutes };
