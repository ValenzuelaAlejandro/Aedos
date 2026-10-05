(function registerDebugCanvasTitle(global) {
    'use strict';

    /** Extract the existing user-facing title from debug canvas HTML.
     * @param {string} html
     * @param {string} [fallbackTitle='Debug Canvas']
     * @returns {string}
     */
    function extractDebugCanvasTitle(html, fallbackTitle = 'Debug Canvas') {
        if (!html || typeof html !== 'string') return fallbackTitle;

        const configMatch = html.match(/<!--\s*CONFIG\s*([\s\S]*?)\s*-->/i);
        if (configMatch) {
            try {
                const configObj = JSON.parse(configMatch[1]);
                if (configObj.Clean_Topic) return configObj.Clean_Topic;
                if (configObj.topic) return configObj.topic;
            } catch (e) { /* Keep the legacy fallback for malformed embedded config. */ }
        }

        const titleMatch = html.match(/<title>\s*(.*?)\s*<\/title>/i);
        if (titleMatch && titleMatch[1]) return titleMatch[1];

        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match && h1Match[1]) {
            const cleanTitle = h1Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanTitle) return cleanTitle;
        }

        return fallbackTitle;
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.extractDebugCanvasTitle = extractDebugCanvasTitle;
})(globalThis);
