(function registerPreviewLoadingHtml(global) {
    'use strict';

    /** Return the existing font links and iframe loading markup verbatim. */
    function getPreviewLoadingHtml() {
        const fonts = `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
        return `
        ${fonts}
        <style class="skeleton-injector">
            body { background: #121212; margin: 0; padding: 0; }
        </style>
        <link rel="stylesheet" href="/editor/editor.css?v=3">
        <script type="module" src="/editor/editor.js?v=4"></script>
        `;
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.getPreviewLoadingHtml = getPreviewLoadingHtml;
})(window);
