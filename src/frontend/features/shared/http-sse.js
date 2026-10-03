(function registerHttpSse(global) {
    'use strict';

    /** @typedef {'line' | 'event'} SseFraming */
    /** @typedef {ReadableStreamDefaultReader<Uint8Array>} SseReader */
    /** @typedef {{ framing: SseFraming, flushTail?: boolean, onChunk?: () => void }} SseOptions */
    /** @typedef {{ data: string, tail: boolean }} SseData */

    /**
     * Convert one existing frontend frame into its raw data payload, retaining
     * the original distinction between the skeleton and presentation readers.
     * @param {string} frame
     * @param {SseFraming} framing
     * @returns {string | null}
     */
    function extractPayload(frame, framing) {
        if (framing === 'line') {
            if (!frame.startsWith('data: ')) return null;
            const payload = frame.slice(6).trim();
            return payload || null;
        }
        if (frame.trim() === '' || !frame.startsWith('data: ')) return null;
        return frame.substring(6);
    }

    /**
     * Read raw SSE payloads from an already-open HTTP response reader.
     * Deliberately does not flush TextDecoder at EOF, matching the two legacy
     * loops; `flushTail` only reproduces presentation-generation's text tail.
     * @param {SseReader} reader
     * @param {SseOptions} options
     * @returns {AsyncGenerator<SseData>}
     */
    async function* readPayloads(reader, options) {
        const { framing, flushTail = false, onChunk } = options;
        if (framing !== 'line' && framing !== 'event') {
            throw new TypeError(`Unsupported SSE framing: ${framing}`);
        }
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (onChunk) onChunk();
            buffer += decoder.decode(value, { stream: true });

            const frames = framing === 'line' ? buffer.split('\n') : buffer.split('\n\n');
            buffer = frames.pop() || '';
            for (const frame of frames) {
                const payload = extractPayload(frame, framing);
                if (payload !== null) yield { data: payload, tail: false };
            }
        }

        if (flushTail && buffer.trim()) {
            for (const line of buffer.split('\n')) {
                const payload = extractPayload(line, 'event');
                if (payload !== null) yield { data: payload, tail: true };
            }
        }
    }

    /**
     * Stream parsed data records from a reader whose cancellation owner is the caller.
     * @param {SseReader} reader
     * @param {SseOptions} options
     * @returns {AsyncGenerator<SseData>}
     */
    function readReader(reader, options) {
        return readPayloads(reader, options);
    }

    /**
     * Open an HTTP response body while keeping access to its reader for cancel.
     * @param {Response} response
     * @param {SseOptions} options
     * @returns {{ reader: SseReader, events: AsyncGenerator<SseData> }}
     */
    function openResponse(response, options) {
        const reader = response.body.getReader();
        return { reader, events: readReader(reader, options) };
    }

    global.AedosHttpSse = Object.freeze({ openResponse, readReader });
})(window);
