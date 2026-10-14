'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerEntryRoutes } = require('../../src/backend/http/routes/entry');

test('/api/models includes authoritative billing and exposes NVIDIA trial models only on a keyed local server', async () => {
    const previous = { mode: process.env.NODE_ENV, key: process.env.NVIDIA_API_KEY, enabled: process.env.ENABLE_NVIDIA_LOCAL };
    const handlers = {};
    const app = { get(path, handler) { handlers[path] = handler; } };
    registerEntryRoutes({ app, tmpDir: '.', isDevelopment: false });
    const request = { hostname: 'localhost', headers: { host: 'localhost:3000' }, socket: { remoteAddress: '::1' } };
    const response = {
        headers: {},
        set(name, value) { this.headers[name] = value; return this; },
        json(body) { this.body = body; return this; },
    };
    try {
        process.env.NODE_ENV = 'development';
        process.env.NVIDIA_API_KEY = 'test-key';
        delete process.env.ENABLE_NVIDIA_LOCAL;
        await handlers['/api/models'](request, response);
        assert.equal(response.body.models.some(model => model.id.startsWith('nvidia-build/')), false);
        process.env.ENABLE_NVIDIA_LOCAL = 'true';
        await handlers['/api/models'](request, response);
        assert.equal(response.body.models.some(model => model.id.startsWith('nvidia-build/')), true);
        assert.deepEqual(response.body.models.find(model => model.id === 'google/gemini-3-flash-preview')?.billing,
            'perPresentation');
        assert.equal(response.body.models.find(model => model.id === 'google/gemini-3-flash-preview')?.creditsPerPresentation, 10);
        assert.equal(response.headers['Cache-Control'], 'no-store');
        delete process.env.NVIDIA_API_KEY;
        await handlers['/api/models'](request, response);
        assert.equal(response.body.models.some(model => model.id.startsWith('nvidia-build/')), false);
        process.env.NVIDIA_API_KEY = 'test-key';
        process.env.NODE_ENV = 'production';
        request.hostname = 'public.example';
        request.headers.host = 'public.example';
        request.socket.remoteAddress = '198.51.100.20';
        await handlers['/api/models'](request, response);
        assert.equal(response.body.models.some(model => model.id.startsWith('nvidia-build/')), false);
    } finally {
        for (const [key, value] of [['NODE_ENV', previous.mode], ['NVIDIA_API_KEY', previous.key], ['ENABLE_NVIDIA_LOCAL', previous.enabled]]) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
