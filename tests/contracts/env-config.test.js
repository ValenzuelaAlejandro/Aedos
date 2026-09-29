const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEnvConfig } = require('../../src/backend/config/env');

test('environment config preserves defaults and derived queue thresholds', () => {
    const config = loadEnvConfig({});
    assert.equal(config.port, 3000);
    assert.equal(config.runtimeEnv, 'development');
    assert.equal(config.maxConcurrentGenerations, 10);
    assert.equal(config.maxQueueDepth, 40);
    assert.equal(config.proPauseQueueDepth, 24);
    assert.equal(config.proPauseActiveGenerations, 8);
    assert.equal(config.pressureRetryAfterSec, 30);
    assert.equal(config.puppeteerMaxConcurrent, 3);
    assert.equal(config.puppeteerMaxQueue, 10);
    assert.equal(config.providerAcceptTimeoutMs, 30000);
});

test('environment config preserves invalid, empty and numeric-string parsing', () => {
    const config = loadEnvConfig({
        PORT: '',
        NODE_ENV: 'TEST',
        MAX_CONCURRENT_GENERATIONS: '4',
        MAX_QUEUE_DEPTH: '7',
        PRO_PAUSE_QUEUE_DEPTH: '0',
        PRO_PAUSE_ACTIVE_GENERATIONS: 'bad',
        PRESSURE_RETRY_AFTER_SEC: '12x',
        PUPPETEER_MAX_CONCURRENT: '-1',
        PUPPETEER_MAX_QUEUE: '6',
        PROVIDER_ACCEPT_TIMEOUT_MS: '45000',
    });
    assert.equal(config.port, 3000);
    assert.equal(config.runtimeEnv, 'test');
    assert.equal(config.maxConcurrentGenerations, 4);
    assert.equal(config.maxQueueDepth, 7);
    assert.equal(config.proPauseQueueDepth, 8);
    assert.equal(config.proPauseActiveGenerations, 2);
    assert.equal(config.pressureRetryAfterSec, 12);
    assert.equal(config.puppeteerMaxConcurrent, 3);
    assert.equal(config.puppeteerMaxQueue, 6);
    assert.equal(config.providerAcceptTimeoutMs, 45000);
});
