const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const catalogSource = fs.readFileSync(path.join(root, 'src/frontend/config/model-catalog.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'src/frontend/features/credits/credits-service.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'src/frontend/features/credits/credits-ui.js'), 'utf8');

function loadCredits(hostname) {
    const values = new Map();
    const requests = [];
    const window = {
        location: hostname ? { hostname } : undefined,
        crypto: { randomUUID: () => 'request-id-0001' },
        localStorage: {
            getItem: key => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
        },
        fetch: async (url, options = {}) => {
            requests.push({ url, options });
            if (url === '/api/usage') return { ok: true, json: async () => ({ dailyUnits: 50000, remainingUnits: 17000, geminiAvailable: false,
                paidPaused: true, resetsAt: '2026-10-14T00:00:00.000Z' }) };
            if (url === '/api/models') return { ok: true, json: async () => ({ models: [
                { id: 'api/model', name: 'API model', tier: 'free', billing: 'perSlide', usagePerSlideUnits: { flash: 500, pro: 1000 } },
            ], paymentsPaused: true }) };
            if (url === '/api/credits/spend') return { ok: true, json: async () => ({ costUnits: 1000, remainingUnits: 16000,
                resetsAt: '2026-10-14T00:00:00.000Z' }) };
            return { ok: false, json: async () => ({}) };
        },
    };
    vm.runInNewContext(catalogSource, { window });
    vm.runInNewContext(serviceSource, { window });
    return { window, values, requests };
}

test('daily usage defaults to server balance and does not use localStorage for balance changes', async () => {
    const { window, values, requests } = loadCredits();
    const service = window.AedosCredits;
    assert.equal((await window.AedosCredits.getCredits()).balance, 17000);
    assert.equal((await window.AedosCredits.getCredits()).geminiAvailable, false);
    const models = await window.AedosCredits.getModels();
    assert.equal(models.models[0].id, 'api/model');
    assert.equal(models.paymentsPaused, true);
    const charged = await service.spend(999, 'add-element', 'request-id-0001');
    assert.equal(charged.ok, true);
    assert.equal(charged.balance, 16000);
    const spendRequest = requests.find(request => request.url === '/api/credits/spend');
    assert.equal(spendRequest.options.headers['Idempotency-Key'], 'request-id-0001');
    assert.deepEqual(JSON.parse(spendRequest.options.body), { operation: 'add-element' });
    assert.equal(values.size, 0);
});

test('credits service retries only transient API failures', async () => {
    const { window } = loadCredits();
    window.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(window.AedosCredits.getCredits(), error => error.retryable === true);

    window.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(window.AedosCredits.getCredits(), error => error.retryable === false);
});

test('Vercel proxies API paths to Render without caching credit snapshots', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'src/frontend/vercel.json'), 'utf8'));
    assert.ok(config.rewrites.some(rule => rule.source === '/api/:path*'
        && rule.destination === 'https://aedos.onrender.com/api/:path*'));
    assert.ok(config.headers.some(rule => rule.source === '/api/:path*'
        && rule.headers.some(header => header.key === 'x-vercel-enable-rewrite-caching' && header.value === '0')));
});

test('catalog uses server-configured milli-credit slide rates', () => {
    const { window } = loadCredits();
    assert.equal(window.MODEL_CATALOG.length, 4);
    assert.deepEqual(JSON.parse(JSON.stringify(window.MODEL_CATALOG.map(model => [model.billing, model.usagePerSlideUnits.flash, model.usagePerSlideUnits.pro]))), [
        ['perSlide', 1600, 3200], ['perSlide', 800, 1600], ['perSlide', 1200, 2400], ['perSlide', 1200, 2400],
    ]);
    assert.equal(window.MODE_SURCHARGE, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(window.MAX_SLIDES_BY_MODE)), { flash: 8, pro: 15 });
});

test('frontend catalog contains no removed local models and follows server visibility', async () => {
    const { window } = loadCredits('aedos.example');
    assert.equal(window.MODEL_CATALOG.some(model => model.id.startsWith(`${['nvi', 'dia'].join('')}-build/`)), false);
    const apiModels = await window.AedosCredits.getModels();
    assert.deepEqual(apiModels.models.map(model => model.id), ['api/model']);
});

test('slide zones cover each mode maximum without gaps or overlap', () => {
    const { window } = loadCredits();
    const expected = {
        1: [],
        2: [['short', 1, 1], ['full', 2, 2]],
        3: [['short', 1, 1], ['balanced', 2, 2], ['full', 3, 3]],
        8: [['short', 1, 3], ['balanced', 4, 6], ['full', 7, 8]],
        15: [['short', 1, 5], ['balanced', 6, 10], ['full', 11, 15]],
    };
    for (const [max, ranges] of Object.entries(expected)) {
        const zones = window.getSlideZones(Number(max));
        assert.deepEqual(JSON.parse(JSON.stringify(zones.map(({ key, start, end }) => [key, start, end]))), ranges);
        if (zones.length) assert.deepEqual(JSON.parse(JSON.stringify(zones.flatMap(zone => Array.from({ length: zone.end - zone.start + 1 }, (_, i) => zone.start + i)))), Array.from({ length: Number(max) }, (_, i) => i + 1));
    }
});

test('service quotes mode-specific usage units and enforces the current slide maximum', () => {
    const { window } = loadCredits();
    window.AedosStores = { generation: { state: { proModeEnabled: false, selectedModelId: window.MODEL_CATALOG[0].id } } };
    vm.runInNewContext(uiSource, { window });
    const gemini = window.MODEL_CATALOG[0];
    const standard = window.MODEL_CATALOG.find(model => model.tier === 'standard');
    const nemotron = window.MODEL_CATALOG.find(model => model.id === 'nvidia/nemotron-3.5-lightning');

    assert.equal(window.AedosCreditsUI.getQuote(15, gemini).total, 12800);
    assert.equal(window.AedosCreditsUI.getQuote(8, standard).total, 9600);
    assert.equal(window.AedosCreditsUI.getQuote(15, nemotron).slides, 8);
    assert.equal(window.AedosCreditsUI.getQuote(15, nemotron).total, 6400);
    window.AedosStores.generation.state.proModeEnabled = true;
    assert.equal(window.AedosCreditsUI.getQuote(8, gemini).total, 25600);
    assert.equal(window.AedosCreditsUI.getQuote(8, standard).total, 19200);
    assert.equal(window.AedosCreditsUI.getQuote(15, standard).total, 36000);
    assert.equal(window.AedosCreditsUI.getQuote(15, standard).slides, 15);
    assert.equal(window.AedosCreditsUI.getQuote(15, nemotron).slides, 15);
    assert.equal(window.AedosCreditsUI.getQuote(15, nemotron).total, 24000);
});

test('every offered model/mode/slide value fits a fresh daily balance and matches backend billing', async () => {
    const { MODEL_CATALOG } = require('../src/backend/config/model-catalog');
    const { DAILY_USAGE_UNITS } = require('../src/backend/config/usage-policy');
    const { normalizeSlides } = require('../src/backend/contracts/request-normalizers');
    const { quoteModel, createGenerationCreditsMiddleware } = require('../src/backend/http/middleware/generation-credits');
    const { createMemoryCreditsLedger } = require('../src/backend/utils/credits-ledger');
    const { window } = loadCredits();
    const ledger = createMemoryCreditsLedger();
    const middleware = createGenerationCreditsMiddleware({ ledger });
    assert.deepEqual(Object.keys(MODEL_CATALOG).sort(), Array.from(window.MODEL_CATALOG, model => model.id).sort());
    for (const model of window.MODEL_CATALOG) {
        const backend = MODEL_CATALOG[model.id];
        assert.equal(model.usagePerSlideUnits.pro, model.usagePerSlideUnits.flash * 2);
        for (const [mode, maximum] of Object.entries({ flash: 8, pro: 15 })) {
            assert.equal(window.MAX_SLIDES_BY_MODE[mode], maximum);
            assert.equal(model.maxSlides[mode], maximum);
            assert.equal(backend.maxSlides[mode], maximum);
            assert.equal(normalizeSlides({ mode, slides: maximum + 1 }).valid, false);
            for (let slides = 1; slides <= maximum; slides += 1) {
                const quote = window.AedosCredits.quote(model, slides, mode);
                assert.equal(quote.total, quoteModel(backend, slides, slides, mode));
                assert.ok(quote.total <= DAILY_USAGE_UNITS, `${model.id}/${mode}/${slides} exceeds the daily allowance`);
                assert.equal(normalizeSlides({ mode, slides }).valid, true);
                const id = `${model.id}-${mode}-${slides}`.replace(/[^a-z0-9-]/gi, '-');
                const req = { body: { modelId: model.id, mode, slides },
                    headers: { 'idempotency-key': id }, socket: { remoteAddress: id } };
                const res = { status() { return this; }, json(body) { throw new Error(JSON.stringify(body)); } };
                let proceeded = false;
                await middleware(req, res, () => { proceeded = true; });
                assert.equal(proceeded, true, `${id} must reserve successfully at the full daily allowance`);
                assert.equal(req.creditCost, quote.total);
                assert.equal(await ledger.commit(req.creditReservation, quote.total), true);
                assert.equal(await ledger.getRemaining(id), DAILY_USAGE_UNITS - quote.total,
                    'The successful final debit must equal the exact pre-generation UI quote.');
                assert.equal(await ledger.commit(req.creditReservation, quote.total), true);
                assert.equal(await ledger.getRemaining(id), DAILY_USAGE_UNITS - quote.total, 'Replayed completion cannot debit again.');
            }
        }
    }
});
