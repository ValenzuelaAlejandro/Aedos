(function registerChatRenderer(global) {
    'use strict';

    /** Escapes text for insertion into HTML markup. */
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /** Returns the innerHTML for one legacy chat-bubble attachment chip. */
    function renderFileChip(file) {
        const displayName = file.name && file.name.length > 24
            ? file.name.substring(0, 21) + '...'
            : (file.name || 'file');

        let iconMarkup;
        if (file.type && file.type.startsWith('image/')) {
            iconMarkup = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;flex-shrink:0;opacity:0.75;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
        } else if (file.type && file.type.includes('pdf') || (file.name && file.name.endsWith('.pdf'))) {
            iconMarkup = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" style="margin-right:6px;flex-shrink:0;"><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#E2231A"/><path d="M14 2v6h6z" fill="#B0150F"/><text x="11" y="16.5" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="6.2" font-weight="900" text-anchor="middle" letter-spacing="-0.3px">PDF</text></svg>`;
        } else if (file.name && (file.name.endsWith('.docx') || file.name.endsWith('.doc'))) {
            iconMarkup = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" style="margin-right:6px;flex-shrink:0;"><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#185ABD"/><path d="M14 2v6h6z" fill="#103F8A"/><text x="11" y="16.5" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="7.5" font-weight="900" text-anchor="middle">W</text></svg>`;
        } else {
            iconMarkup = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;flex-shrink:0;opacity:0.75;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        }

        return `${iconMarkup}${escapeHtml(displayName)}`;
    }

    global.AedosChatRenderer = Object.freeze({ renderFileChip });
    // Preserve the helper consumed as a global identifier by legacy scripts.
    global.escapeHtml = escapeHtml;
})(window);
