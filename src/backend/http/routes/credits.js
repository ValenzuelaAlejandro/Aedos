'use strict';

const { readRequestId, getRequestIp, DAILY_CREDITS, resetAt } = require('../../utils/credits-ledger');
const { getSpendStatus } = require('../../utils/spend-guard');

function registerCreditsRoutes({ app, ledger, hasGeminiRequestAvailable }) {
    app.get('/api/credits', async (req, res) => {
        try {
            const now = new Date();
            const remaining = await ledger.getRemaining(getRequestIp(req), now);
            const [geminiAvailable, spendStatus] = await Promise.all([
                hasGeminiRequestAvailable?.() ?? false,
                getSpendStatus(),
            ]);
            res.set('Cache-Control', 'no-store');
            return res.json({ daily: DAILY_CREDITS, remaining, resetsAt: resetAt(now).toISOString(),
                geminiAvailable: Boolean(geminiAvailable), paidPaused: Boolean(spendStatus.paidPaused) });
        } catch (_) {
            return res.status(503).json({ error: 'CREDITS_UNAVAILABLE', message: 'Credits are temporarily unavailable. Try again shortly.' });
        }
    });

    app.post('/api/credits/spend', async (req, res) => {
        const operation = req.body?.operation;
        if (operation !== 'chat' && operation !== 'add-element') {
            return res.status(400).json({ error: 'INVALID_CREDIT_OPERATION' });
        }
        const requestId = readRequestId(req);
        if (!requestId) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
        try {
            const result = await ledger.spend(getRequestIp(req), 1, requestId);
            if (result.status === 'insufficient') {
                return res.status(402).json({ error: 'INSUFFICIENT_CREDITS', code: 'INSUFFICIENT_CREDITS',
                    cost: 1, remaining: result.remaining, resetsAt: result.resetsAt,
                    message: 'You need 1 credit for this action. Wait for the daily reset or try again later.' });
            }
            if (result.status !== 'spent') {
                return res.status(409).json({ error: 'CREDIT_OPERATION_ALREADY_APPLIED', remaining: result.remaining });
            }
            return res.json({ ok: true, cost: 1, remaining: result.remaining, resetsAt: result.resetsAt });
        } catch (_) {
            return res.status(503).json({ error: 'CREDITS_UNAVAILABLE', message: 'Credits are temporarily unavailable. Try again shortly.' });
        }
    });
}

module.exports = { registerCreditsRoutes };
