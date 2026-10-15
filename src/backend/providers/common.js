const responseControllers = new WeakMap();

/**
 * Fetch with the existing provider acceptance timeout semantics.
 * @param {string} url provider URL
 * @param {RequestInit} options fetch options
 * @param {number} timeoutMs timeout in milliseconds
 * @param {string} timeoutMessage stable timeout error message
 * @returns {Promise<Response>} provider response
 */
async function fetchWithAcceptTimeout(url, options, timeoutMs, timeoutMessage) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
        const response = await fetch(url, { ...options, signal });
        responseControllers.set(response, controller);
        return response;
    } catch (err) {
        if (options.signal?.aborted) {
            const code = options.signal.reason?.message === 'REQUEST_TOTAL_TIMEOUT'
                ? 'PROVIDER_REQUEST_TIMEOUT' : 'PROVIDER_CANCELLED';
            throw new Error(code, { cause: err });
        }
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw new Error(timeoutMessage, { cause: err });
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

function abortProviderResponse(response) { responseControllers.get(response)?.abort(); }

module.exports = { fetchWithAcceptTimeout, abortProviderResponse };
