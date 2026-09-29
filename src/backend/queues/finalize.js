/**
 * Puppeteer finalize concurrency state and pressure controls.
 * @param {{runtimeConfig: {puppeteerMaxConcurrent: number, puppeteerMaxQueue: number, pressureRetryAfterSec: number}, puppeteerLog: {info: Function, warn: Function}, ErrorCategory: Record<string, string>, queueFullFinalize: Function}} deps queue dependencies
 * @returns {{checkPressure: Function, enqueue: Function, release: Function, snapshot: Function}}
 */
function createFinalizeQueue({ runtimeConfig, puppeteerLog, ErrorCategory, queueFullFinalize }) {
    let activeFinalize = 0;
    const finalizeQueue = [];
    const PUPPETEER_MAX_CONCURRENT = runtimeConfig.puppeteerMaxConcurrent;
    const PUPPETEER_MAX_QUEUE = runtimeConfig.puppeteerMaxQueue;
    const PRESSURE_RETRY_AFTER_SEC = runtimeConfig.pressureRetryAfterSec;

    function snapshot() {
        return { activeFinalize, queueDepth: finalizeQueue.length };
    }

    function processQueue() {
        if (finalizeQueue.length > 0 && activeFinalize < PUPPETEER_MAX_CONCURRENT) {
            const item = finalizeQueue.shift();
            activeFinalize++;
            item.resolve();
            puppeteerLog.info(ErrorCategory.QUEUE, 'Puppeteer queued request resumed', snapshot());
        }
    }

    function checkPressure(req, res, next) {
        const state = snapshot();
        if (
            state.activeFinalize >= PUPPETEER_MAX_CONCURRENT &&
            state.queueDepth >= PUPPETEER_MAX_QUEUE
        ) {
            puppeteerLog.warn(ErrorCategory.QUEUE, 'Puppeteer queue full - request rejected', {
                requestId: req.requestId,
                ip: req.ip,
                activeFinalize: state.activeFinalize,
                queueDepth: state.queueDepth
            });
            return res.status(429).json(queueFullFinalize(PRESSURE_RETRY_AFTER_SEC));
        }
        next();
    }

    /**
     * @param {import('http').IncomingMessage} req request
     * @param {{requestId: string, logQueued?: boolean, puppeteerLog?: {warn: Function}, ErrorCategory?: Record<string, string>}} input request state
     * @returns {Promise<boolean>} true when a slot was acquired
     */
    async function enqueue(req, { requestId, logQueued = false }) {
        const state = snapshot();
        if (state.activeFinalize < PUPPETEER_MAX_CONCURRENT) {
            activeFinalize++;
            return true;
        }

        if (logQueued) {
            puppeteerLog.warn(ErrorCategory.QUEUE, 'Puppeteer queued due to concurrency limit', {
                requestId,
                activeFinalize: state.activeFinalize,
                queueDepth: state.queueDepth
            });
        }
        const obtainedSlot = await new Promise((resolve) => {
            const item = { resolve: () => resolve(true) };
            finalizeQueue.push(item);
            req.on('close', () => {
                const index = finalizeQueue.indexOf(item);
                if (index !== -1) {
                    finalizeQueue.splice(index, 1);
                    resolve(false);
                }
            });
        });
        return obtainedSlot;
    }

    function release() {
        activeFinalize--;
        processQueue();
    }

    return { checkPressure, enqueue, release, snapshot };
}

module.exports = { createFinalizeQueue };
