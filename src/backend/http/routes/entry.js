const fs = require('fs');
const path = require('path');
const { MODEL_CATALOG } = require('../../config/model-catalog');
const { getSpendStatus } = require('../../utils/spend-guard');

/**
 * Register health, root and development inspection endpoints.
 *
 * @param {{app: any, tmpDir: string, isDevelopment: boolean}} deps
 * @returns {void}
 */
function registerEntryRoutes({ app, tmpDir, isDevelopment }) {
    app.get('/api/models', async (req, res) => {
        const models = Object.values(MODEL_CATALOG)
            .map(model => ({
                id: model.id,
                name: model.name,
                provider: model.provider,
                brand: model.brand,
                tier: model.tier,
                paid: model.paid,
                billing: model.billing,
                creditsPerSlide: model.billing === 'perSlide' ? model.creditsPerSlide : undefined,
                creditsPerPresentation: model.billing === 'perPresentation' ? model.creditsPerPresentation : undefined,
                attachments: model.attachments,
                modes: model.modes,
                maxSlides: model.maxSlides,
            }));
        const spendStatus = await getSpendStatus();
        res.set('Cache-Control', 'no-store');
        res.json({ models, paymentsPaused: Boolean(spendStatus.paidPaused) });
    });

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

    if (isDevelopment) {
        app.get('/__dev__/chat-design-preview', (req, res) => {
            res.set('Cache-Control', 'no-store');
            res.json({ enabled: true });
        });
    }

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
