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
            if (url === '/api/credits') return { ok: true, json: async () => ({ daily: 50, remaining: 17, geminiAvailable: false,
                paidPaused: true, resetsAt: '2026-10-14T00:00:00.000Z' }) };
            if (url === '/api/models') return { ok: true, json: async () => ({ models: [
                { id: 'api/model', name: 'API model', tier: 'free', billing: 'perSlide', creditsPerSlide: 1 },
            ], paymentsPaused: true }) };
            if (url === '/api/credits/spend') return { ok: true, json: async () => ({ cost: 1, remaining: 16,
                resetsAt: '2026-10-14T00:00:00.000Z' }) };
            return { ok: false, json: async () => ({}) };
        },
    };
    vm.runInNewContext(catalogSource, { window });
    vm.runInNewContext(serviceSource, { window });
    return { window, values, requests };
}

test('credits default to server balance and do not use localStorage for balance changes', async () => {
    const { window, values, requests } = loadCredits();
    const service = window.AedosCredits;
    assert.equal((await window.AedosCredits.getCredits()).balance, 17);
    assert.equal((await window.AedosCredits.getCredits()).geminiAvailable, false);
    const models = await window.AedosCredits.getModels();
    assert.equal(models.models[0].id, 'api/model');
    assert.equal(models.paymentsPaused, true);
    const charged = await service.spend(999, 'add-element', 'request-id-0001');
    assert.equal(charged.ok, true);
    assert.equal(charged.balance, 16);
    const spendRequest = requests.find(request => request.url === '/api/credits/spend');
    assert.equal(spendRequest.options.headers['Idempotency-Key'], 'request-id-0001');
    assert.deepEqual(JSON.parse(spendRequest.options.body), { operation: 'add-element' });
    assert.equal(values.size, 0);
});

test('catalog uses explicit billing types', () => {
    const { window } = loadCredits();
    assert.equal(window.MODEL_CATALOG.length, 4);
    assert.deepEqual(JSON.parse(JSON.stringify(window.MODEL_CATALOG.map(model => [model.billing, model.creditsPerPresentation || model.creditsPerSlide]))), [
        ['perPresentation', 10], ['perSlide', 2], ['perSlide', 3], ['perSlide', 3],
    ]);
    assert.equal(window.MODE_SURCHARGE, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(window.MAX_SLIDES_BY_MODE)), { flash: 15, pro: 8 });
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

test('service quotes presentation and slide billing without a mode surcharge', () => {
    const { window } = loadCredits();
    window.AedosStores = { generation: { state: { proModeEnabled: false, selectedModelId: window.MODEL_CATALOG[0].id } } };
    vm.runInNewContext(uiSource, { window });
    const gemini = window.MODEL_CATALOG[0];
    const standard = window.MODEL_CATALOG.find(model => model.tier === 'standard');
    const nemotron = window.MODEL_CATALOG.find(model => model.id === 'nvidia/nemotron-3.5-lightning');

    assert.equal(window.AedosCreditsUI.getQuote(15, gemini).total, 10);
    assert.equal(window.AedosCreditsUI.getQuote(8, standard).total, 24);
    assert.equal(window.AedosCreditsUI.getQuote(15, nemotron).slides, 8);
    assert.equal(window.AedosCreditsUI.getQuote(15, nemotron).total, 16);
    window.AedosStores.generation.state.proModeEnabled = true;
    assert.equal(window.AedosCreditsUI.getQuote(8, gemini).total, 10);
    assert.equal(window.AedosCreditsUI.getQuote(8, standard).total, 24);
    assert.equal(window.AedosCreditsUI.getQuote(15, standard).total, 24);
    assert.equal(window.AedosCreditsUI.getQuote(15, standard).slides, 8);
});
