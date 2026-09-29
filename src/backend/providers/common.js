/**
 * Fetch with the existing provider acceptance timeout semantics.
 * @param {string} url provider URL
 * @param {object} options fetch options
 * @param {number} timeoutMs timeout in milliseconds
 * @param {string} timeoutMessage stable timeout error message
 * @returns {Promise<Response>} provider response
 */
async function fetchWithAcceptTimeout(url, options, timeoutMs, timeoutMessage) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw new Error(timeoutMessage, { cause: err });
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

module.exports = { fetchWithAcceptTimeout };
