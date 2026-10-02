/* eslint-disable max-lines-per-function */
/**
 * Generation concurrency state and pressure controls.
 * @param {{runtimeConfig: {maxConcurrentGenerations: number, maxQueueDepth: number, proPauseQueueDepth: number, proPauseActiveGenerations: number, pressureRetryAfterSec: number}, queueLog: {debug: Function, info: Function, warn: Function}, ErrorCategory: Record<string, string>, queueFullGeneration: Function, proTemporarilyPaused: Function, writeSse: Function}} deps queue dependencies
 * @returns {{checkPressure: Function, enqueue: Function, release: Function, snapshot: Function}}
 */
function createGenerationQueue({ runtimeConfig, queueLog, ErrorCategory, queueFullGeneration, proTemporarilyPaused, writeSse }) {
    let activeGenerations = 0;
    const queue = [];
    const MAX_CONCURRENT_GENERATIONS = runtimeConfig.maxConcurrentGenerations;
    const MAX_QUEUE_DEPTH = runtimeConfig.maxQueueDepth;
    const PRO_PAUSE_QUEUE_DEPTH = runtimeConfig.proPauseQueueDepth;
    const PRO_PAUSE_ACTIVE_GENERATIONS = runtimeConfig.proPauseActiveGenerations;
    const PRESSURE_RETRY_AFTER_SEC = runtimeConfig.pressureRetryAfterSec;

    function snapshot() {
        return { activeGenerations, queueDepth: queue.length };
    }

    function normalizeGenerationMode(body) {
        return body?.mode === 'pro' ? 'pro' : 'flash';
    }

    function checkPressure(req, res, next) {
        const requestId = req.requestId || 'n/a';
        const mode = normalizeGenerationMode(req.body);
        const state = snapshot();

        if (
            mode === 'pro' &&
            (
                state.activeGenerations >= PRO_PAUSE_ACTIVE_GENERATIONS ||
                state.queueDepth >= PRO_PAUSE_QUEUE_DEPTH
            )
        ) {
            queueLog.warn(ErrorCategory.QUEUE, 'Pro mode temporarily paused due to high load', {
                requestId,
                ip: req.ip,
                mode,
                activeGenerations: state.activeGenerations,
                queueDepth: state.queueDepth,
                proPauseActiveThreshold: PRO_PAUSE_ACTIVE_GENERATIONS,
                proPauseQueueThreshold: PRO_PAUSE_QUEUE_DEPTH
            });
            return res.status(503).json(proTemporarilyPaused(PRESSURE_RETRY_AFTER_SEC));
        }

        if (
            state.activeGenerations >= MAX_CONCURRENT_GENERATIONS &&
            state.queueDepth >= MAX_QUEUE_DEPTH
        ) {
            queueLog.warn(ErrorCategory.QUEUE, 'Queue full - request rejected', {
                requestId,
                ip: req.ip,
                mode,
                activeGenerations: state.activeGenerations,
                queueDepth: state.queueDepth,
                maxConcurrent: MAX_CONCURRENT_GENERATIONS,
                maxQueueDepth: MAX_QUEUE_DEPTH
            });
            return res.status(429).json(queueFullGeneration(PRESSURE_RETRY_AFTER_SEC));
        }

        next();
    }

    function processQueue() {
        if (activeGenerations < MAX_CONCURRENT_GENERATIONS && queue.length > 0) {
            const { resolve } = queue.shift();
            activeGenerations++;
            queueLog.debug(ErrorCategory.QUEUE, 'Generation dequeued', snapshot());
            resolve();
        }
    }

    /**
     * @param {import('http').IncomingMessage} req request
     * @param {{requestId: string, mode: string, usePipeline: boolean, res: import('express').Response}} input request state
     * @returns {Promise<'acquired'|'disconnected'|'rejected'>} queue result
     */
    async function enqueue(req, { requestId, usePipeline, res }) {
        const state = snapshot();
        if (state.activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
            if (state.queueDepth >= MAX_QUEUE_DEPTH) {
                queueLog.warn(ErrorCategory.QUEUE, 'Queue reached hard cap while request was entering queue', {
                    requestId,
                    activeGenerations: state.activeGenerations,
                    queueDepth: state.queueDepth,
                    maxConcurrent: MAX_CONCURRENT_GENERATIONS,
                    maxQueueDepth: MAX_QUEUE_DEPTH
                });
                writeSse(res, { error: 'QUEUE_FULL', retryAfterSec: PRESSURE_RETRY_AFTER_SEC });
                res.end();
                return 'rejected';
            }

            if (
                usePipeline &&
                (
                    state.activeGenerations >= PRO_PAUSE_ACTIVE_GENERATIONS ||
                    state.queueDepth >= PRO_PAUSE_QUEUE_DEPTH
                )
            ) {
                queueLog.warn(ErrorCategory.QUEUE, 'Pro mode request rejected while entering queue due to pressure', {
                    requestId,
                    activeGenerations: state.activeGenerations,
                    queueDepth: state.queueDepth,
                    proPauseActiveThreshold: PRO_PAUSE_ACTIVE_GENERATIONS,
                    proPauseQueueThreshold: PRO_PAUSE_QUEUE_DEPTH
                });
                writeSse(res, { error: 'PRO_TEMPORARILY_PAUSED', retryAfterSec: PRESSURE_RETRY_AFTER_SEC });
                res.end();
                return 'rejected';
            }

            queueLog.warn(ErrorCategory.QUEUE, 'Generation queued due to concurrency limit', {
                requestId,
                activeGenerations: state.activeGenerations,
                queueDepth: state.queueDepth,
                maxConcurrent: MAX_CONCURRENT_GENERATIONS
            });
            writeSse(res, { queued: true, position: state.queueDepth + 1 });
            let removeCloseListener = () => {};
            const obtainedSlot = await new Promise((resolve) => {
                const item = { resolve: () => resolve(true) };
                queue.push(item);
                const removeQueuedRequest = () => {
                    if (res.writableEnded) return;
                    const idx = queue.indexOf(item);
                    if (idx !== -1) {
                        queue.splice(idx, 1);
                        queueLog.warn(ErrorCategory.QUEUE, 'Queued request removed because client disconnected', {
                            requestId,
                            queueDepth: queue.length
                        });
                        resolve(false);
                    }
                };
                res.on('close', removeQueuedRequest);
                removeCloseListener = () => res.off('close', removeQueuedRequest);
            });
            removeCloseListener();
            if (!obtainedSlot) return 'disconnected';
            writeSse(res, { queued: false });
            const resumedState = snapshot();
            queueLog.info(ErrorCategory.QUEUE, 'Queued request resumed', {
                activeGenerations: resumedState.activeGenerations,
                queueDepth: resumedState.queueDepth
            });
        } else {
            activeGenerations++;
            queueLog.debug(ErrorCategory.QUEUE, 'Generation started without queue wait', snapshot());
        }
        return 'acquired';
    }

    function release() {
        activeGenerations = Math.max(0, activeGenerations - 1);
        queueLog.debug(ErrorCategory.QUEUE, 'Generation slot released', snapshot());
        processQueue();
    }

    return { checkPressure, enqueue, release, snapshot };
}

module.exports = { createGenerationQueue };
