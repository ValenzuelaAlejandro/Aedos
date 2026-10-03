/**
 * Removes dangerous CSS imports and declarations from a style value.
 * @param {string} style CSS text or a style attribute value
 * @returns {string} filtered styles
 */
function sanitizeStyleValue(style) {
    return style
        .replace(
            /@import\s+(?!(?:url\(\s*)?["']?https:\/\/fonts\.googleapis\.com\/css)[^;]*;?/gi,
            '',
        )
        .replace(
            /(^|[;{])\s*(?:behavior\s*:\s*[^;}]*|[-\w]+\s*:\s*[^;}]*?(?:url\s*\(\s*["']?\s*(?:javascript\s*:|data\s*:\s*text\/html)|javascript\s*:|expression\s*\(|-moz-binding)[^;}]*)(?=;|}|$)/gi,
            '$1',
        );
}

/**
 * Strips unsafe fragments from generated HTML.
 * @param {string} html
 * @returns {string}
 */
function sanitizeGeneratedHtml(html) {
    if (typeof html !== 'string') return html;
    html = html.replace(/<(iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    html = html.replace(/<\/?(?:iframe|object|embed)\b[^>]*>/gi, '');
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<script[^>]*>/gi, '');
    html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
    html = html.replace(
        /\s+(href|src|action|formaction|xlink:href)\s*=\s*(?:"\s*(?:javascript\s*:|data\s*:\s*text\/html)[^"]*"|'\s*(?:javascript\s*:|data\s*:\s*text\/html)[^']*'|(?:javascript\s*:|data\s*:\s*text\/html)[^\s>]*)/gi,
        '',
    );
    html = html.replace(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi, (full, doubleQuoted, singleQuoted, unquoted) => {
        const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : '';
        const cleaned = sanitizeStyleValue(doubleQuoted ?? singleQuoted ?? unquoted ?? '')
            .replace(/^;+/, '');
        return cleaned.trim() ? ` style=${quote}${cleaned}${quote}` : '';
    });
    html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (full, attrs, style) => {
        return `<style${attrs}>${sanitizeStyleValue(style)}</style>`;
    });
    html = html.replace(/<link[^>]*href\s*=\s*["']\s*url\(\s*['"]?https:\/\/fonts\.googleapis\.com[\s\S]*?\/>/gi, '');
    return html;
}

module.exports = { sanitizeGeneratedHtml };
