const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const catalogSource = fs.readFileSync(path.join(root, 'src/frontend/config/model-catalog.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'src/frontend/features/credits/credits-service.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'src/frontend/features/credits/credits-ui.js'), 'utf8');

function loadCredits() {
    const values = new Map();
    const window = {
        localStorage: {
            getItem: key => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
        },
        fetch: async url => ({ ok: true, json: async () => url === '/api/credits'
            ? { balance: 17, dailyLimit: 50 }
            : { models: [{ id: 'api/model', tier: 'free', billing: 'perSlide', creditsPerSlide: 1 }], paymentsPaused: true } }),
    };
    vm.runInNewContext(catalogSource, { window });
    vm.runInNewContext(serviceSource, { window });
    return { window, values };
}

test('mock credits are daily, spend atomically within one tab store, and refund failed work', async () => {
    const { window, values } = loadCredits();
    const service = window.AedosCredits;
    assert.equal((await service.getCredits()).balance, 50);
    assert.equal(service.spend(49).ok, true);
    assert.equal(service.spend(2).ok, false);
    assert.equal((await service.getCredits()).balance, 1);
    service.refund(4);
    assert.equal((await service.getCredits()).balance, 5);
    const saved = JSON.parse(values.get('aedos-credit-mock-v1'));
    saved.day = '2000-01-01';
    values.set('aedos-credit-mock-v1', JSON.stringify(saved));
    assert.equal((await service.getCredits()).balance, 50);
});

test('API adapter can replace simulated credits and model catalog without changing callers', async () => {
    const { window } = loadCredits();
    window.AedosCredits.setApiMode(true);
    assert.equal((await window.AedosCredits.getCredits()).balance, 17);
    const models = await window.AedosCredits.getModels();
    assert.equal(models.models[0].id, 'api/model');
    assert.equal(models.paymentsPaused, true);
});

test('catalog uses explicit billing types and excludes Dots', () => {
    const { window } = loadCredits();
    assert.equal(window.MODEL_CATALOG.length, 5);
    assert.equal(window.MODEL_CATALOG.some(model => model.id.startsWith('dots-studio/')), false);
    assert.deepEqual(JSON.parse(JSON.stringify(window.MODEL_CATALOG.map(model => [model.billing, model.creditsPerPresentation || model.creditsPerSlide]))), [
        ['perPresentation', 10], ['perSlide', 1], ['perSlide', 2], ['perSlide', 3], ['perSlide', 3],
    ]);
    assert.equal(window.MODE_SURCHARGE, undefined);
});

test('service quotes presentation and slide billing without a mode surcharge', () => {
    const { window } = loadCredits();
    window.AedosStores = { generation: { state: { proModeEnabled: false, selectedModelId: window.MODEL_CATALOG[0].id } } };
    vm.runInNewContext(uiSource, { window });
    const gemini = window.MODEL_CATALOG[0];
    const apodex = window.MODEL_CATALOG[1];
    const standard = window.MODEL_CATALOG.find(model => model.tier === 'standard');

    assert.equal(window.AedosCreditsUI.getQuote(15, gemini).total, 10);
    assert.equal(window.AedosCreditsUI.getQuote(8, apodex).total, 8);
    assert.equal(window.AedosCreditsUI.getQuote(8, standard).total, 24);
    window.AedosStores.generation.state.proModeEnabled = true;
    assert.equal(window.AedosCreditsUI.getQuote(8, gemini).total, 10);
    assert.equal(window.AedosCreditsUI.getQuote(8, apodex).total, 8);
    assert.equal(window.AedosCreditsUI.getQuote(8, standard).total, 24);
    assert.equal(window.AedosCreditsUI.getQuote(15, standard).total, 24);
    assert.equal(window.AedosCreditsUI.getQuote(15, standard).slides, 8);
});
