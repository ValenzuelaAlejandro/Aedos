const Module = require('node:module');

function deferred() {
    let release;
    const promise = new Promise((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

function sseResponse(frames, options = {}) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            try {
                for (const frame of frames) {
                    if (frame && frame.waitFor) await frame.waitFor;
                    if (frame && frame.delayMs) await new Promise((resolve) => setTimeout(resolve, frame.delayMs));
                    if (frame && frame.error) throw frame.error;
                    const data = typeof frame === 'string' ? frame : frame.data;
                    controller.enqueue(encoder.encode(data));
                }
                controller.close();
            } catch (error) {
                controller.error(error);
            }
        }
    });
    return new Response(stream, {
        status: options.status || 200,
        headers: { 'content-type': 'text/event-stream' }
    });
}

function jsonFrame(value) {
    return `data: ${JSON.stringify(value)}\n\n`;
}

/**
 * Install programmable network fakes before loading server.js.
 * @param {{gemini?: Function, openrouter?: Function, genai?: object}} handlers
 * @returns {{restore: Function, deferred: Function, sseResponse: Function, jsonFrame: Function}}
 */
function installProviderFakes(handlers = {}) {
    const originalFetch = global.fetch;
    const originalLoad = Module._load;
    global.fetch = async (url, options) => {
        const target = String(url);
        if (target.includes('generativelanguage.googleapis.com')) {
            return handlers.gemini ? handlers.gemini({ url: target, options }) : new Response('fake Gemini missing');
        }
        if (target.includes('openrouter.ai')) {
            return handlers.openrouter ? handlers.openrouter({ url: target, options }) : new Response('fake OpenRouter missing');
        }
        return originalFetch(url, options);
    };
    Module._load = function (request, parent, isMain) {
        if (request === '@google/genai' && handlers.genai) return handlers.genai;
        return originalLoad.call(this, request, parent, isMain);
    };
    return {
        restore() {
            global.fetch = originalFetch;
            Module._load = originalLoad;
        },
        deferred,
        sseResponse,
        jsonFrame
    };
}

module.exports = { deferred, sseResponse, jsonFrame, installProviderFakes };
