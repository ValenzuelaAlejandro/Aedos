'use strict';

const fs = require('node:fs');
const path = require('node:path');

const baseUrl = (process.env.AEDOS_LOCAL_URL || 'http://localhost:3127').replace(/\/$/, '');
const evidenceDir = path.resolve('test-evidence');
const logFile = path.resolve(process.env.AEDOS_LOCAL_LOG || path.join(evidenceDir, 'local-server.stdout.log'));
const summaryPath = path.join(evidenceDir, 'nvidia-evaluation.json');
const defaultCandidates = [
    'nvidia-build/nemotron-3.5-lightning',
    'nvidia-build/nemotron-3-super',
    'nvidia-build/nemotron-3-ultra',
    'nvidia-build/glm-5.3',
];
const candidates = process.env.AEDOS_NVIDIA_CANDIDATES
    ? process.env.AEDOS_NVIDIA_CANDIDATES.split(',').map(value => value.trim()).filter(Boolean)
    : defaultCandidates;
const modes = process.env.AEDOS_NVIDIA_MODES
    ? process.env.AEDOS_NVIDIA_MODES.split(',').map(value => value.trim()).filter(Boolean)
    : ['flash', 'pro'];
const topic = 'Onboarding de CRM para una pyme mexicana, equipo comercial, tono práctico, exactamente 5 diapositivas.';

function parseEvents(raw) {
    return raw.split(/\r?\n\r?\n/).flatMap(block => {
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => line.slice(6));
        return data.flatMap(line => {
            try { return [JSON.parse(line)]; } catch (_) { return []; }
        });
    });
}

async function post(pathname, body) {
    try {
        const response = await fetch(`${baseUrl}${pathname}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(190000),
        });
        const raw = await response.text();
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
        return { status: response.status, events: parseEvents(raw), error: parsed?.code || parsed?.error || null };
    } catch (error) {
        return { status: 0, events: [], error: error?.name === 'TimeoutError' || error?.name === 'AbortError'
            ? 'CLIENT_TIMEOUT' : 'REQUEST_FAILED' };
    }
}

function validateHtml(html) {
    const sections = html.match(/<section\b[^>]*\bclass="[^"]*\bs\b[^"]*"/gi) || [];
    const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const spanishContent = /\b(de|para|con|equipo|empresa|ventas|clientes|proceso|negocio|pyme)\b/i.test(text);
    return {
        complete: /^<!doctype html>/i.test(html.trim()) && /<\/html>\s*$/i.test(html),
        slideCount: sections.length,
        language: /<html\b[^>]*\blang="es"/i.test(html),
        spanishContent,
    };
}

function failedCase(modelId, mode, started, logOffset, stage, error, extra = {}) {
    return { modelId, mode, attempts: 1, passed: false, stage, error, ...extra,
        providerCalls: providerCallsSince(logOffset, modelId), durationMs: Date.now() - started };
}

function validateProviderCalls(providerCalls, mode) {
    const expectedCalls = mode === 'pro' ? ['Stage1', 'Stage2', 'Stage3'] : ['Stage1', 'Flash'];
    const stagesObserved = new Set(providerCalls.map(call => call.stage));
    const callsComplete = expectedCalls.every(stage => stagesObserved.has(stage));
    const callsStayedOnNvidia = providerCalls.length > 0 && providerCalls.every(call => call.provider === 'nvidia');
    const callsStopped = callsComplete && providerCalls.every(call => call.finish_reason === 'stop');
    return { callsComplete, callsStayedOnNvidia, callsStopped };
}

function providerCallsPass(validation) {
    return validation.callsComplete && validation.callsStayedOnNvidia && validation.callsStopped;
}

function generatedHtmlPasses(slides, html) {
    return slides === 5 && html.complete && html.slideCount === 5 && html.language && html.spanishContent;
}

function selectedModelPasses(event, modelId) {
    return event.requestedModelId === modelId && event.effectiveModelId === modelId && event.fallbackReason === null;
}

function completedWithinLimit(started) {
    return Date.now() - started < 180000;
}

function isSuccessfulResponse(status, event) {
    return status === 200 && Boolean(event);
}

function modeStagesPass(mode, stageNames) {
    return mode !== 'pro' || stageNames.includes('design');
}

async function runCase(modelId, mode) {
    const started = Date.now();
    const logPath = logFile;
    const logOffset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    const base = { modelId, mode, slides: 5, tema: topic, language: 'es', idioma: 'es' };
    const skeletonResult = await post('/generate-skeleton', base);
    const skeletonEvent = skeletonResult.events.find(event => event.done && event.skeleton);
    if (!isSuccessfulResponse(skeletonResult.status, skeletonEvent)) {
        return failedCase(modelId, mode, started, logOffset, 'schema', skeletonResult.error || 'SCHEMA_FAILED');
    }

    const skeletonSlides = Array.isArray(skeletonEvent.skeleton.slides) ? skeletonEvent.skeleton.slides.length : 0;
    const finalResult = await post('/generate', { ...base, skeleton: skeletonEvent.skeleton });
    const finalEvent = finalResult.events.find(event => event.done && typeof event.html === 'string');
    if (!isSuccessfulResponse(finalResult.status, finalEvent)) {
        const error = finalResult.error || finalResult.events.find(event => event.code)?.code || 'GENERATION_FAILED';
        return failedCase(modelId, mode, started, logOffset, 'generation', error, { schemaSlides: skeletonSlides });
    }

    const htmlResult = validateHtml(finalEvent.html);
    const stageNames = finalResult.events.filter(event => event.pipeline && event.status === 'done').map(event => event.stage);
    const stage2Completed = modeStagesPass(mode, stageNames);
    const providerCalls = providerCallsSince(logOffset, modelId);
    const callValidation = validateProviderCalls(providerCalls, mode);
    const passed = generatedHtmlPasses(skeletonSlides, htmlResult) && stage2Completed
        && providerCallsPass(callValidation) && completedWithinLimit(started) && selectedModelPasses(finalEvent, modelId);
    const outputPath = path.join(evidenceDir, `${modelId.replace(/[^a-z0-9-]/gi, '-')}-${mode}.html`);
    fs.writeFileSync(outputPath, finalEvent.html, 'utf8');
    return { modelId, mode, attempts: 1, passed, schemaSlides: skeletonSlides, ...htmlResult,
        stage2JsonParsed: stage2Completed, requestedModelId: finalEvent.requestedModelId,
        effectiveModelId: finalEvent.effectiveModelId, fallbackReason: finalEvent.fallbackReason,
        providerCalls, durationMs: Date.now() - started, htmlPath: outputPath };
}

function providerCallsSince(offset, modelId) {
    const logs = logFile;
    if (!fs.existsSync(logs)) return [];
    const buffer = fs.readFileSync(logs);
    const lines = buffer.subarray(offset).toString('utf8').trim().split(/\r?\n/);
    return lines.flatMap(line => {
        try {
            const event = JSON.parse(line);
            return event.event === 'provider_call' && event.provider === 'nvidia'
                && event.model && event.model.includes(modelId.split('/').at(-1))
                ? [event] : [];
        } catch (_) { return []; }
    });
}

async function main() {
    fs.mkdirSync(evidenceDir, { recursive: true });
    const health = await fetch(`${baseUrl}/health`);
    if (!health.ok) throw new Error(`Local server not healthy: ${health.status}`);
    const catalog = await (await fetch(`${baseUrl}/api/models`)).json();
    const available = new Set(catalog.modelIds || []);
    const results = [];
    for (const modelId of candidates) {
        if (!available.has(modelId)) {
            results.push({ modelId, passed: false, error: 'MODEL_NOT_LISTED' });
            continue;
        }
        for (const mode of modes) {
            const logPath = logFile;
            const before = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
            let result = await runCase(modelId, mode);
            const latestCalls = providerCallsSince(before, modelId);
            const timedOut = result.error === 'CLIENT_TIMEOUT'
                || latestCalls.some(call => ['accept_timeout', 'stream_timeout'].includes(call.finish_reason));
            if (!result.passed && timedOut && result.attempts === 1) {
                const retry = await runCase(modelId, mode);
                result = { ...retry, attempts: 2, retryOf: 'timeout' };
            }
            results.push(result);
            fs.writeFileSync(summaryPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
            process.stdout.write(`${JSON.stringify(result)}\n`);
        }
    }
    fs.writeFileSync(summaryPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    process.stdout.write(`SUMMARY ${JSON.stringify({ cases: results.length, passed: results.filter(item => item.passed).length, summaryPath })}\n`);
}

main().catch(error => {
    process.stderr.write(`Evaluation failed: ${error.message}\n`);
    process.exitCode = 1;
});
