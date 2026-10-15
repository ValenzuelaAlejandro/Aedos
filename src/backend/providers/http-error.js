const { abortProviderResponse } = require('./common');

/** Read bounded error bodies without logging vendor text or waiting indefinitely. */
async function readProviderError(response) {
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let bytes = 0, timer;
    try {
        const read = async () => {
            for (;;) {
                const part = await reader.read();
                if (part.done) break;
                bytes += part.value.byteLength;
                if (bytes > 16384) return null;
                chunks.push(Buffer.from(part.value));
            }
            try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { return null; }
        };
        return await Promise.race([read(), new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]);
    } finally {
        clearTimeout(timer);
        abortProviderResponse(response);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

module.exports = { readProviderError };
