/**
 * Strips unsafe fragments from generated HTML.
 * @param {string} html
 * @returns {string}
 */
function sanitizeGeneratedHtml(html) {
    if (typeof html !== 'string') return html;
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<script[^>]*>/gi, '');
    html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
    html = html.replace(/\s+(href|src|action)\s*=\s*["']javascript:[^"']*["']/gi, '');
    html = html.replace(/<link[^>]*href\s*=\s*["']\s*url\(\s*['"]?https:\/\/fonts\.googleapis\.com[\s\S]*?\/>/gi, '');
    return html;
}

module.exports = { sanitizeGeneratedHtml };
