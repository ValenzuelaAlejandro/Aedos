'use strict';
require('./redacted-output');

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Redis } = require('@upstash/redis');
const { createGeminiProvider } = require('../../src/backend/providers/gemini');
const { createOpenRouterProvider } = require('../../src/backend/providers/openrouter');
const { createSelectedModelRouter } = require('../../src/backend/providers/model-selection');
const { providerRequestContext } = require('../../src/backend/providers/request-context');
const { fetchWithAcceptTimeout } = require('../../src/backend/providers/common');
const { createSpendGuard } = require('../../src/backend/utils/spend-guard');
const { verifyPreproductionServer } = require('./preproduction-safety');
const { createModelConfig } = require('../../src/backend/config/models');
const { createCreditsLedger } = require('../../src/backend/utils/credits-ledger');

const MODEL_ID = 'google/gemini-3-flash-preview';
const MODEL_PROVIDER_ID = 'gemini-3-flash-preview';
const ACK = 'ISOLATED_PREPRODUCTION_ONLY';
const LIVE_MAX_OUTPUT_TOKENS = 512;

function validateInputs() {
    const required = [
        'GEMINI_API_KEY',
        'OPENROUTER_API_KEY',
        'AEDOS_GEMINI_429_API_KEY',
        'AEDOS_LIVE_REDIS_LABEL',
        'UPSTASH_REDIS_REST_URL',
        'UPSTASH_REDIS_REST_TOKEN',
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Missing required variables: ${missing.join(', ')}`);
    if (process.env.AEDOS_LIVE_TEST_ACK !== ACK) {
        throw new Error(
            `Set AEDOS_LIVE_TEST_ACK=${ACK} after confirming the provider keys and Redis belong to isolated preproduction.`,
        );
    }
    if (!/preprod|staging|isolated/i.test(process.env.AEDOS_LIVE_REDIS_LABEL)) {
        throw new Error(
            'AEDOS_LIVE_REDIS_LABEL must identify an isolated preproduction/staging Redis database.',
        );
    }
}

function cutAfterFirstContentFrame(response) {
    if (!response.body) throw new Error('Gemini live response had no body to cut.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    let finished = false;
    let cutPending = false;
    const body = new ReadableStream({
        async pull(controller) {
            if (finished) return;
            if (cutPending) {
                finished = true;
                controller.error(new Error('INJECTED_REAL_UPSTREAM_STREAM_CUT'));
                return;
            }
            try {
                while (true) {
                    const read = await reader.read();
                    if (read.done) {
                        finished = true;
                        if (buffer) controller.enqueue(encoder.encode(buffer));
                        controller.close();
                        return;
                    }
                    buffer += decoder.decode(read.value, { stream: true }).replace(/\r\n/g, '\n');
                    let boundary;
                    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                        const frame = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const data = frame
                            .split('\n')
                            .filter((line) => line.startsWith('data:'))
                            .map((line) => line.slice(5).trim())
                            .join('\n');
                        if (!data) {
                            controller.enqueue(encoder.encode(`${frame}\n\n`));
                            continue;
                        }
                        let parsed;
                        try {
                            parsed = JSON.parse(data);
                        } catch (_) {
                            controller.enqueue(encoder.encode(`${frame}\n\n`));
                            continue;
                        }
                        const candidate = parsed.candidates?.[0];
                        const hasText = candidate?.content?.parts?.some(
                            (part) => typeof part.text === 'string' && part.text.length,
                        );
                        if (!hasText) {
                            controller.enqueue(encoder.encode(`${frame}\n\n`));
                            continue;
                        }
                        // Keep any streamed partial content but remove a terminal marker so the
                        // adapter observes a genuine transport cut after yielding those bytes.
                        delete candidate.finishReason;
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
                        cutPending = true;
                        await reader.cancel().catch(() => {});
                        return;
                    }
                }
            } catch (error) {
                finished = true;
                controller.error(error);
            }
        },
        async cancel() {
            finished = true;
            await reader.cancel().catch(() => {});
        },
    });
    const headers = new Headers(response.headers);
    for (const key of ['content-length', 'content-encoding', 'transfer-encoding'])
        headers.delete(key);
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function makeFetch({ cutGemini = false, fault = null } = {}) {
    return (url, init, timeoutMs, timeoutMessage) =>
        (fault === 'unavailable' ? Promise.resolve(new Response('{}', { status: 503 }))
            : fetchWithAcceptTimeout(url, init, timeoutMs, timeoutMessage)).then(async (response) => {
            if (response.ok && String(url).includes('generativelanguage.googleapis.com') && ['empty', 'safety'].includes(fault)) {
                await response.body?.cancel();
                return new Response(`data: ${JSON.stringify({ candidates: [{ finishReason: fault === 'safety' ? 'SAFETY' : 'STOP' }] })}\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            }
            return (
            cutGemini && String(url).includes('generativelanguage.googleapis.com')
                ? cutAfterFirstContentFrame(response)
                : response);
        });
}

function makeRouter({ redis, cutGemini = false, fault = null }) {
    const env = {
        ...process.env,
        PAID_SPEND_DAILY_USD: '0.25',
        PAID_SPEND_MONTHLY_USD: '1',
        PAID_SPEND_PER_IP_DAILY_USD: '0.05',
        AI_SPEND_MAX_REQUEST_USD: '0.05',
        AI_SPEND_RESERVATION_MARGIN: '1.25',
        GEMINI_DAILY_APP_CAP: '16',
    };
    const guard = createSpendGuard({ redis: () => redis, env });
    const fetcher = makeFetch({ cutGemini, fault });
    const providerLog = {
        warn(category, message, fields) {
            process.stderr.write(
                `${JSON.stringify({ event: 'live_provider_test_warning', category, message, ...fields })}\n`,
            );
        },
    };
    const gemini = createGeminiProvider({
        fetchWithAcceptTimeout: fetcher,
        providerAcceptTimeoutMs: 30_000,
        guard,
    });
    const openrouter = createOpenRouterProvider({
        fetchWithAcceptTimeout: fetcher,
        providerAcceptTimeoutMs: 30_000,
        reasoningForStage: createModelConfig(env).reasoningForStage,
        providerLog,
        guard,
    });
    const router = createSelectedModelRouter({
        gemini: gemini.call,
        openrouter: openrouter.call,
        providerLog,
        ErrorCategory: { PROVIDER: 'PROVIDER' },
        getOverride: () => null,
        createStub: () => {
            throw new Error('Test provider stub is disabled in live verification.');
        },
        shouldUseTestStub: () => false,
    });
    return router.makeCaller('Flash', MODEL_PROVIDER_ID, [MODEL_ID]);
}

async function settleScenario({ name, requestId, context, ledger, redis, reservation, expectFailure, failure }) {
    if (expectFailure) {
        assert.ok(failure, `${name}: all routes must fail`);
        await ledger.refund(reservation);
        assert.equal(await ledger.getRemaining(context.clientIp), 50000, 'Failed routes cannot consume user usage.');
        const attempts = Object.values(await redis.hgetall(`{aedos-provider-calls}:request:${requestId}`))
            .map(value => typeof value === 'string' ? JSON.parse(value) : value);
        assert.equal(attempts.length, 3);
        assert.ok(attempts.every(row => row.requestId === requestId && row.outcome !== 'complete'));
        process.stdout.write(`${JSON.stringify({ result: 'passed', scenario: name, requestId, failure: failure.message, usageUnits: 0 })}\n`);
        return false;
    }
    assert.ifError(failure);
    await ledger.commit(reservation, 1000);
    await ledger.commit(reservation, 1000);
    assert.equal(await ledger.getRemaining(context.clientIp), 49000, 'Successful retries consume exactly once.');
    return true;
}

function assertSafetyAttempts(fault, rows) {
    if (fault === 'safety') assert.equal(rows.length, 2, 'Safety allows exactly one additional attempt.');
}

// eslint-disable-next-line max-lines-per-function -- Keep stream consumption and its assertions together for each real-provider scenario.
async function runScenario({
    name,
    redis,
    apiKey,
    cutGemini = false,
    expectProvider,
    expectReason = null,
    modelId = MODEL_ID,
    fault = null,
    expectFailure = false,
}) {
    process.env.GEMINI_API_KEY = apiKey;
    const requestId = `aedos-preprod-${name}-${crypto.randomUUID()}`;
    const controller = new AbortController();
    const body = { modelId, mode: 'flash' };
    const options = {
        selectedModel: { id: modelId },
        maxOutputTokens: LIVE_MAX_OUTPUT_TOKENS,
        signal: controller.signal,
        streamTotalTimeoutMs: 30_000,
        streamIdleTimeoutMs: 20_000,
    };
    const caller = makeRouter({ redis, cutGemini, fault });
    const events = [];
    const context = {
        requestId,
        req: { body },
        signal: controller.signal,
        startedAt: Date.now(),
        clientIp: `preprod-${crypto.randomUUID()}`,
    };
    const ledger = createCreditsLedger({ redis: () => redis });
    const reservation = await ledger.reserve(context.clientIp, 1000, requestId);
    assert.equal(reservation.allowed, true);
    let failure;
    try { await providerRequestContext.run(context, async () => {
        const response = await caller(
            'Answer with a short greeting and one sentence about solar energy.',
            null,
            options,
        );
        for await (const event of response.stream) events.push(event);
        events.push({ type: 'verified_complete' });
    }); } catch (error) { failure = error; }
    if (!(await settleScenario({ name, requestId, context, ledger, redis, reservation, expectFailure, failure }))) return;
    const providers = events
        .filter((event) => event.type === 'metadata')
        .map((event) => event.provider);
    const models = events.filter((event) => event.type === 'metadata').map((event) => event.model);
    const resetReasons = events
        .filter((event) => event.type === 'reset')
        .map((event) => event.reason);
    const firstContentIndex = events.findIndex(
        (event) => event.type === 'content' || (typeof event === 'string' && event.length > 0),
    );
    const firstResetIndex = events.findIndex((event) => event.type === 'reset');
    const content = events.reduce((draft, event) => event.type === 'reset' ? ''
        : draft + (typeof event === 'string' ? event : event.type === 'content' ? event.text || '' : ''), '');
    assert.ok(content.trim(), `${name}: expected streamed content`);
    assert.equal(
        events.at(-1).type,
        'verified_complete',
        `${name}: stream should complete normally after the successful route`,
    );
    assert.equal(
        providers.at(-1),
        expectProvider,
        `${name}: final provider should be ${expectProvider}`,
    );
    assert.ok(
        models.length > 0 && models.every((model) => model === modelId),
        `${name}: every provider attempt must retain the selected model`,
    );
    assert.ok(
        providers.every((provider) => provider === expectProvider || provider === 'gemini'),
        `${name}: response must stay on the selected model`,
    );
    if (expectReason)
        assert.ok(
            resetReasons.includes(expectReason),
            `${name}: expected reset reason ${expectReason}`,
        );
    if (name === 'gemini-stream-cut') {
        assert.ok(
            firstContentIndex >= 0 && firstResetIndex > firstContentIndex,
            'stream-cut: real Gemini text must reach the client before the reset',
        );
    }
    const persisted = await redis.hgetall(`{aedos-provider-calls}:request:${requestId}`);
    const rows = Object.values(persisted || {})
        .map((row) => {
            try {
                return typeof row === 'string' ? JSON.parse(row) : row;
            } catch (_) {
                return null;
            }
        })
        .filter(Boolean);
    assert.ok(
        rows.length >= providers.length,
        `${name}: provider attempts must be persisted under request ID`,
    );
    assert.ok(
        rows.every(
            (row) =>
                row.requestId === requestId &&
                row.requestedModelId === modelId &&
                row.effectiveModelId === modelId,
        ),
        `${name}: telemetry correlation/model mismatch`,
    );
    assert.equal(
        rows.filter((row) => row.outcome === 'complete').length,
        1,
        `${name}: exactly one provider attempt should complete successfully`,
    );
    const completedRow = rows.find((row) => row.outcome === 'complete');
    assertSafetyAttempts(fault, rows);
    assert.ok(
        Number.isFinite(completedRow?.cost_usd) && typeof completedRow.cost_estimated === 'boolean',
        `${name}: completed provider call must report cost with actual/estimated status`,
    );
    process.stdout.write(
        `${JSON.stringify({
            result: 'passed',
            scenario: name,
            requestId,
            selectedModel: modelId,
            providers,
            resetReasons,
            streamedCharacters: content.length,
            correlatedAttempts: rows.length,
        })}\n`,
    );
    return { events, requestId, providers, resetReasons };
}

async function main() {
    validateInputs();
    await verifyPreproductionServer();
    const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    const originalKey = process.env.GEMINI_API_KEY;
    try {
        await runScenario({
            name: 'gemini-valid',
            redis,
            apiKey: originalKey,
            expectProvider: 'gemini',
        });
        await runScenario({
            name: 'gemini-http-failure',
            redis,
            apiKey: `${originalKey}.aedos-invalid-test-suffix`,
            expectProvider: 'openrouter',
            expectReason: 'provider_unavailable',
        });
        await runScenario({
            name: 'gemini-stream-cut',
            redis,
            apiKey: originalKey,
            cutGemini: true,
            expectProvider: 'openrouter',
            expectReason: 'stream_failed',
        });
        await runScenario({
            name: 'gemini-low-quota-429',
            redis,
            apiKey: process.env.AEDOS_GEMINI_429_API_KEY,
            expectProvider: 'openrouter',
            expectReason: 'rate_limited',
        });
        for (const [fault, reason] of [['empty', 'empty_response'], ['safety', 'safety']]) {
            await runScenario({ name: `gemini-${fault}`, redis, apiKey: originalKey,
                fault, expectProvider: 'openrouter', expectReason: reason });
        }
        await runScenario({ name: 'openrouter-unavailable', redis, apiKey: originalKey,
            fault: 'unavailable', expectProvider: null, expectFailure: true });
        for (const modelId of ['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna', 'nvidia/nemotron-3.5-lightning']) {
            await runScenario({ name: `openrouter-${modelId.split('/')[0]}`, redis, apiKey: originalKey,
                modelId, expectProvider: 'openrouter' });
        }
        process.stdout.write('Live provider verification passed. No deployment was performed.\n');
    } finally {
        process.env.GEMINI_API_KEY = originalKey;
    }
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
