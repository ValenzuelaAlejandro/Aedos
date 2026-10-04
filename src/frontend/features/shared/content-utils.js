/** @typedef {{sanitizeModelOutput: (html: unknown) => unknown, gifToStaticDataUrl: (file: File) => Promise<string>}} AedosContentUtils */

(function installAedosContentUtils(global) {
    /** @param {unknown} html @returns {unknown} */
    function sanitizeModelOutput(html) {
        if (typeof html !== 'string') return html;
        html = html.replace(/<script[^>]*>(\s*)<\/script>/gi, '$1');
        html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        html = html.replace(/<script[^>]*>/gi, '');
        html = html.replace(/<script\b[^>]*/gi, '');
        html = html.replace(/<\/script>/gi, '');
        html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
        html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
        html = html.replace(/\s+(href|src|action)\s*=\s*["']javascript:[^"']*["']/gi, '');
        html = html.replace(/<link[^>]*\/?>/gi, '');
        html = html.replace(/<link\b[^>]*/gi, '');
        return html;
    }

    /** @param {File} file @returns {Promise<string>} */
    function gifToStaticDataUrl(file) {
        if (!file.type.includes('gif')) {
            return new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = event => resolve(event.target.result);
                reader.readAsDataURL(file);
            });
        }
        return new Promise(resolve => {
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth || image.width;
                canvas.height = image.naturalHeight || image.height;
                canvas.getContext('2d').drawImage(image, 0, 0);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/jpeg', 0.9));
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                const reader = new FileReader();
                reader.onload = event => resolve(event.target.result);
                reader.readAsDataURL(file);
            };
            image.src = url;
        });
    }

    const api = Object.freeze({ sanitizeModelOutput, gifToStaticDataUrl });
    global.AedosContentUtils = api;
    global.sanitizeModelOutput = sanitizeModelOutput;
    // Compatibility alias consumed by classic editor tools.
    global.gifToStaticDataUrl = gifToStaticDataUrl;
})(window);
