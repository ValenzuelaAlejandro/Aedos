const { ENV_NAMES, DEFAULTS } = require('../contracts/config-defaults');

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** @typedef {Object} EnvConfig
 * @property {string|number} port
 * @property {string} runtimeEnv
 * @property {number} maxConcurrentGenerations
 * @property {number} maxQueueDepth
 * @property {number} proPauseQueueDepth
 * @property {number} proPauseActiveGenerations
 * @property {number} pressureRetryAfterSec
 * @property {number} puppeteerMaxConcurrent
 * @property {number} puppeteerMaxQueue
 * @property {number} providerAcceptTimeoutMs
 */

/**
 * Read the runtime settings currently consumed during server bootstrap.
 * @param {NodeJS.ProcessEnv} env
 * @returns {EnvConfig}
 */
function loadEnvConfig(env = process.env) {
    const maxConcurrentGenerations = parsePositiveInt(
        env[ENV_NAMES.MAX_CONCURRENT_GENERATIONS],
        DEFAULTS.MAX_CONCURRENT_GENERATIONS,
    );
    const maxQueueDepth = parsePositiveInt(env[ENV_NAMES.MAX_QUEUE_DEPTH], DEFAULTS.MAX_QUEUE_DEPTH);
    return {
        port: env[ENV_NAMES.PORT] || DEFAULTS.PORT,
        runtimeEnv: (env[ENV_NAMES.NODE_ENV] || DEFAULTS.NODE_ENV).toLowerCase(),
        maxConcurrentGenerations,
        maxQueueDepth,
        proPauseQueueDepth: parsePositiveInt(
            env[ENV_NAMES.PRO_PAUSE_QUEUE_DEPTH],
            Math.max(8, Math.floor(maxQueueDepth * 0.6)),
        ),
        proPauseActiveGenerations: parsePositiveInt(
            env[ENV_NAMES.PRO_PAUSE_ACTIVE_GENERATIONS],
            Math.max(1, maxConcurrentGenerations - 2),
        ),
        pressureRetryAfterSec: parsePositiveInt(
            env[ENV_NAMES.PRESSURE_RETRY_AFTER_SEC],
            DEFAULTS.PRESSURE_RETRY_AFTER_SEC,
        ),
        puppeteerMaxConcurrent: parsePositiveInt(
            env[ENV_NAMES.PUPPETEER_MAX_CONCURRENT],
            DEFAULTS.PUPPETEER_MAX_CONCURRENT,
        ),
        puppeteerMaxQueue: parsePositiveInt(
            env[ENV_NAMES.PUPPETEER_MAX_QUEUE],
            DEFAULTS.PUPPETEER_MAX_QUEUE,
        ),
        providerAcceptTimeoutMs: parsePositiveInt(
            env[ENV_NAMES.PROVIDER_ACCEPT_TIMEOUT_MS],
            DEFAULTS.PROVIDER_ACCEPT_TIMEOUT_MS,
        ),
    };
}

module.exports = { parsePositiveInt, loadEnvConfig };
