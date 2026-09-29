/**
 * Runtime limits extracted from server.js. Source line comments refer to the
 * pre-extraction Phase 2 baseline.
 */

// server.js:23
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// server.js:24
const MAX_UPLOAD_FILES = 3;
// server.js:19
const ALLOWED_UPLOAD_EXTENSIONS = Object.freeze(['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp']);
// server.js:94
const DEFAULT_MAX_CONCURRENT_GENERATIONS = 10;
// server.js:95
const DEFAULT_MAX_QUEUE_DEPTH = 40;
// server.js:104
const DEFAULT_PRESSURE_RETRY_AFTER_SEC = 30;
// server.js:109
const DEFAULT_PUPPETEER_MAX_CONCURRENT = 3;
// server.js:110
const DEFAULT_PUPPETEER_MAX_QUEUE = 10;
// server.js:1557 / 1851 / 2398
const MAX_TOPIC_CHARACTERS = 600;
const MAX_FLASH_SLIDES = 15;
const MAX_PRO_SLIDES = 8;
// server.js:3951 / 4015
const MAX_EXPORT_HTML_BYTES = 2 * 1024 * 1024;
// server.js:3951 / 4015 / 4208 / 4326
const DOWNLOAD_TTL_MS = 10 * 60 * 1000;
// server.js:2336 (frontend contract; kept here for backend-facing documentation)
const SSE_WATCHDOG_MS = 600000;

module.exports = {
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_FILES,
    ALLOWED_UPLOAD_EXTENSIONS,
    DEFAULT_MAX_CONCURRENT_GENERATIONS,
    DEFAULT_MAX_QUEUE_DEPTH,
    DEFAULT_PRESSURE_RETRY_AFTER_SEC,
    DEFAULT_PUPPETEER_MAX_CONCURRENT,
    DEFAULT_PUPPETEER_MAX_QUEUE,
    MAX_TOPIC_CHARACTERS,
    MAX_FLASH_SLIDES,
    MAX_PRO_SLIDES,
    MAX_EXPORT_HTML_BYTES,
    DOWNLOAD_TTL_MS,
    SSE_WATCHDOG_MS,
};
