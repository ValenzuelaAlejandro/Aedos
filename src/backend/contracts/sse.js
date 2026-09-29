const SSE_HEADERS = Object.freeze({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
});

function formatSseEvent(payload) {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

function writeSse(res, payload) {
    return res.write(formatSseEvent(payload));
}

function setSseHeaders(res) {
    for (const [name, value] of Object.entries(SSE_HEADERS)) res.setHeader(name, value);
    res.flushHeaders();
}

module.exports = { SSE_HEADERS, formatSseEvent, writeSse, setSseHeaders };
