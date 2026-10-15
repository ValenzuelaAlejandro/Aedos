'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerEntryRoutes } = require('../../src/backend/http/routes/entry');

test('/api/models exposes only the fixed catalog and authoritative billing', async () => {
    const handlers = {};
    const app = { get(path, handler) { handlers[path] = handler; } };
    registerEntryRoutes({ app, tmpDir: '.', isDevelopment: false });
    const response = {
        headers: {},
        set(name, value) { this.headers[name] = value; return this; },
        json(body) { this.body = body; return this; },
    };
    await handlers['/api/models']({}, response);
    assert.equal(response.body.models.some(model => model.id.startsWith(`${['nvi', 'dia'].join('')}-build/`)), false);
    assert.deepEqual(response.body.models.find(model => model.id === 'google/gemini-3-flash-preview')?.billing,
        'perSlide');
    assert.deepEqual(response.body.models.find(model => model.id === 'google/gemini-3-flash-preview')?.usagePerSlideUnits,
        { flash: 1600, pro: 3200 });
    const nemotron = response.body.models.find(model => model.id === 'nvidia/nemotron-3.5-lightning');
    assert.equal(nemotron.provider, 'openrouter');
    assert.equal(nemotron.tier, 'light');
    assert.deepEqual(nemotron.usagePerSlideUnits, { flash: 800, pro: 1600 });
    assert.deepEqual(nemotron.maxSlides, { flash: 8, pro: 15 });
    assert.equal(response.headers['Cache-Control'], 'no-store');
});
