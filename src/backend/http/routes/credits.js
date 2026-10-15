'use strict';

const { readRequestId, getRequestIp, DAILY_USAGE, resetAt } = require('../../utils/credits-ledger');
const { UNITS_PER_CREDIT } = require('../../config/usage-policy');
const { getSpendStatus } = require('../../utils/spend-guard');

function registerCreditsRoutes({ app, ledger, hasGeminiRequestAvailable }) {
    const usageHandler = async (req, res) => {
        try {
            const now = new Date();
            const remainingUnits = await ledger.getRemaining(getRequestIp(req), now);
            const [geminiAvailable, spendStatus] = await Promise.all([
                hasGeminiRequestAvailable?.() ?? false,
                getSpendStatus(),
            ]);
            res.set('Cache-Control', 'no-store');
            return res.json({ dailyUnits: DAILY_USAGE, remainingUnits, resetsAt: resetAt(now).toISOString(),
                geminiAvailable: Boolean(geminiAvailable), paidPaused: Boolean(spendStatus.paidPaused),
                spendPaused: Boolean(spendStatus.spendPaused) });
        } catch (_) {
            return res.status(503).json({ error: 'USAGE_UNAVAILABLE', message: 'Daily usage is temporarily unavailable. Try again shortly.' });
        }
    };
    app.get('/api/usage', usageHandler);
    // Keep the old endpoint path during rollout; its payload is the new usage contract.
    app.get('/api/credits', usageHandler);

    app.post('/api/credits/spend', async (req, res) => {
        const operation = req.body?.operation;
        if (operation === 'chat') {
            return res.status(400).json({ error: 'CHAT_USAGE_SERVER_AUTHORITATIVE' });
        }
        if (operation !== 'add-element') return res.status(400).json({ error: 'INVALID_USAGE_OPERATION' });
        const requestId = readRequestId(req);
        if (!requestId) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
        try {
            const result = await ledger.spend(getRequestIp(req), UNITS_PER_CREDIT, requestId);
            if (result.status === 'insufficient') {
                return res.status(402).json({ error: 'INSUFFICIENT_USAGE', code: 'INSUFFICIENT_USAGE',
                    costUnits: UNITS_PER_CREDIT, remainingUnits: result.remaining, resetsAt: result.resetsAt });
            }
            if (result.status !== 'spent') {
                return res.status(409).json({ error: 'USAGE_OPERATION_ALREADY_APPLIED', remainingUnits: result.remaining });
            }
            return res.json({ ok: true, costUnits: UNITS_PER_CREDIT, remainingUnits: result.remaining, resetsAt: result.resetsAt });
        } catch (_) {
            return res.status(503).json({ error: 'USAGE_UNAVAILABLE', message: 'Daily usage is temporarily unavailable. Try again shortly.' });
        }
    });
}

module.exports = { registerCreditsRoutes };
