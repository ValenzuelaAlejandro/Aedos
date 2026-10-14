'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerEntryRoutes } = require('../../src/backend/http/routes/entry');

test('/api/models exposes NVIDIA trial IDs in any environment only when a service key is configured', async () => {
    const previous = { mode: process.env.NODE_ENV, key: process.env.NVIDIA_API_KEY };
    const handlers = {};
    const app = { get(path, handler) { handlers[path] = handler; } };
    registerEntryRoutes({ app, tmpDir: '.', isDevelopment: false });
    const request = { hostname: 'public.example', socket: { remoteAddress: '198.51.100.20' } };
    const response = {
        headers: {},
        set(name, value) { this.headers[name] = value; return this; },
        json(body) { this.body = body; return this; },
    };
    try {
        process.env.NODE_ENV = 'production';
        process.env.NVIDIA_API_KEY = 'test-key';
        await handlers['/api/models'](request, response);
        assert.equal(response.body.modelIds.some(id => id.startsWith('nvidia-build/')), true);
        assert.equal(response.headers['Cache-Control'], 'no-store');
        delete process.env.NVIDIA_API_KEY;
        await handlers['/api/models'](request, response);
        assert.equal(response.body.modelIds.some(id => id.startsWith('nvidia-build/')), false);
        process.env.NVIDIA_API_KEY = 'test-key';
        process.env.NODE_ENV = 'production';
        await handlers['/api/models'](request, response);
        assert.equal(response.body.modelIds.some(id => id.startsWith('nvidia-build/')), true);
    } finally {
        for (const [key, value] of [['NODE_ENV', previous.mode], ['NVIDIA_API_KEY', previous.key]]) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
