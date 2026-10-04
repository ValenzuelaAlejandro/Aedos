(function registerPreviewLifecycle(global) {
    'use strict';

    /**
     * @typedef {Object} PreviewLifecycleDependencies
     * @property {Object} previewState Existing iframe and presentation state.
     * @property {Object} uiLog Existing application logger.
     * @property {Function} setupPreviewInteractions Existing interaction initializer.
     */

    /** Create iframe initialization and slide discovery using existing callbacks. @param {PreviewLifecycleDependencies} deps */
    // eslint-disable-next-line max-lines-per-function -- Both iframe lifecycle operations close over the same live setup state.
    function createPreviewLifecycle({ previewState, uiLog, setupPreviewInteractions }) {
        // eslint-disable-next-line max-lines-per-function, complexity -- Preserve the existing iframe parsing and fallback sequence intact.
        function initPreview(html, callback) {
            let setupDone = false;

            const doSetup = () => {
                if (setupDone) return;
                // Guard: if called before the HTML is parsed (e.g. triggered by the
                // about:blank load of the freshly-cloned iframe), bail out and let
                // the poll retry — do NOT set setupDone so the real load can win.
                const iDoc = previewState.previewIframe.contentDocument ||
                    (previewState.previewIframe.contentWindow && previewState.previewIframe.contentWindow.document);
                if (!iDoc || !iDoc.body || findSlides(iDoc).length === 0) return;
                setupDone = true;

                // Safari iOS: safe repaint trigger using rAF + transform nudge.
                // Do NOT use display:none — Safari unloads iframe content on hide.
                try {
                    requestAnimationFrame(() => {
                        previewState.previewIframe.style.willChange = 'transform';
                        requestAnimationFrame(() => {
                            previewState.previewIframe.style.willChange = '';
                        });
                    });
                    // eslint-disable-next-line no-empty -- Keep Safari repaint as best-effort.
                } catch (e) { }

                setupPreviewInteractions();
                if (typeof callback === 'function') callback();
            };

            if (html) {
                // Anti-flicker: Prevent scrollbars and margins during initial parse
                const antiFlicker = `<style id="anti-flicker">
                    html, body {
                        overflow: hidden !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    }
                </style>`;
                if (!html.includes('anti-flicker')) {
                    html = antiFlicker + html;
                }

                // Editor internals are one native module graph inside the iframe.
                const editorScript = /<script\b(?=[^>]*\bsrc=["'][^"']*editor\.js[^"']*["'])[^>]*><\/script>/i;
                const privateEditorScripts = /<script\b(?=[^>]*\bsrc=["'][^"']*\/features\/editor\/(?:semantics|history|selection-geometry)\.js[^"']*["'])[^>]*><\/script>/gi;
                html = html.replace(privateEditorScripts, '');
                const editorModule = '<script type="module" src="/editor/editor.js?v=4"></script>';

                // Ensure the module entrypoint and its stylesheet are present.
                if (!editorScript.test(html)) {
                    if (html.includes('</body>')) {
                        html = html.replace('</body>', `<link rel="stylesheet" href="/editor/editor.css?v=3">${editorModule}</body>`);
                    } else {
                        html += `<link rel="stylesheet" href="/editor/editor.css?v=3">${editorModule}`;
                    }
                } else {
                    html = html.replace(editorScript, editorModule);
                }
                // Strip all AI-generated googleapis link tags (may have malformed url() hrefs).
                // Both complete and partial/unclosed tags are removed so the correct G_FONTS
                // block below is always the sole font source.
                html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*\/?>/gi, '');
                html = html.replace(/<link\b[^>]*fonts\.googleapis\.com[^>]*/gi, '');

                // Ensure fonts are present
                if (!html.includes('family=Archivo+Black')) {
                    const G_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
                    if (html.includes('<head>')) {
                        html = html.replace('<head>', '<head>' + G_FONTS);
                    } else {
                        html = G_FONTS + html;
                    }
                }

                // Safety Closer: If the AI output ends abruptly (e.g. cut off in mid-comment or mid-tag),
                // force-close them so they don't break the following scripts or icons.
                let safetyCloser = "";
                const openComments = (html.match(/<!--/g) || []).length;
                const closedComments = (html.match(/-->/g) || []).length;
                if (openComments > closedComments) safetyCloser += " -->";

                const openSections = (html.match(/<section/g) || []).length;
                const closedSections = (html.match(/<\/section>/g) || []).length;
                if (openSections > closedSections) safetyCloser += "</section>";

                if (!html.includes('</body>')) safetyCloser += "</body>";
                if (!html.includes('</html>')) safetyCloser += "</html>";

                if (safetyCloser) {
                    html += safetyCloser;
                }

                const doc = previewState.previewIframe.contentDocument || previewState.previewIframe.contentWindow.document;
                // Call doc.open() first to cancel any pending about:blank navigation on
                // the freshly-cloned iframe before we attach the onload handler.
                // If onload were set before doc.open(), the blank-document load event
                // could fire our handler 300ms later on an empty document, setting
                // setupDone=true and permanently locking out the real setup.
                doc.open();

                // On some versions of Safari iOS, setting onload after doc.open can be flaky.
                // We use a combination of onload and an immediate next-tick check.
                const onIframeLoad = () => {
                    if (setupDone) return;
                    uiLog.debug('PREVIEW', 'Iframe load event or completion detected');
                    setTimeout(doSetup, 300);
                };

                previewState.previewIframe.onload = onIframeLoad;

                doc.write('<!DOCTYPE html>' + html);
                doc.close();

                // Extra safety for Safari: if the document is already parsed, fire doSetup
                if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
                    setTimeout(onIframeLoad, 500);
                }
                try {
                    const theme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('app_theme') || 'dark';
                    if (doc && doc.documentElement) doc.documentElement.setAttribute('data-theme', theme);
                } catch (e) {
                    // ignore
                }
                uiLog.debug('PREVIEW', 'Preview iframe updated with final HTML');
            }

            // Try to detect if already loaded (sync srcdoc or manual write)
            const doc = previewState.previewIframe.contentDocument;
            if (doc && doc.readyState === 'complete' && findSlides(doc).length > 0) {
                setTimeout(doSetup, 50);
            }

            // Fallback: poll until slides appear in the DOM (handles slow CDN or missed onload)
            let attempts = 0;
            const poll = () => {
                if (setupDone) return;
                attempts++;
                // eslint-disable-next-line no-shadow -- This lookup intentionally refreshes the iframe document during polling.
                const doc = previewState.previewIframe.contentDocument;
                if (doc && doc.body) {
                    const found = findSlides(doc);
                    if (found.length >= 1) {
                        doSetup();
                        return;
                    }
                }
                if (attempts < 40) {
                    setTimeout(poll, 250); // retry every 250ms, up to 10s
                } else {
                    uiLog.warn('PREVIEW', 'Slide polling exhausted, activating fallback setup', {
                        attempts
                    });
                    // Force-complete setup even if slides aren't found yet
                    // (avoids hanging forever if the HTML has an unexpected structure).
                    if (!setupDone) {
                        setupDone = true;
                        setupPreviewInteractions();
                        if (typeof callback === 'function') callback();
                    }
                }
            };
            setTimeout(poll, 300);
        }

        function findSlides(doc) {
            if (!doc || !doc.body) return [];

            // Strategy 1: section.s (the expected format from our prompt)
            let slides = doc.querySelectorAll('section.s');
            if (slides.length >= 1) return Array.from(slides);

            // Strategy 2: sections with class containing "slide"
            slides = doc.querySelectorAll('section[class*="slide"]');
            if (slides.length >= 1) return Array.from(slides);

            // Strategy 3: leaf sections (sections that don't contain other sections)
            const allSections = Array.from(doc.querySelectorAll('section'));
            const leafSections = allSections.filter(s => !s.querySelector('section'));
            if (leafSections.length >= 1) return leafSections;
            if (allSections.length >= 1) return allSections;

            // Strategy 4: divs with slide-like classes
                // eslint-disable-next-line prefer-const -- Preserve the existing staged selector assignment.
                let divSlides = doc.querySelectorAll('div.s, div.slide, div[class*="slide"]');
            if (divSlides.length >= 1) return Array.from(divSlides);

            // Strategy 5: direct body children (excluding script/style/link/meta AND editor UI)
            const bodyKids = Array.from(doc.body.children).filter(el => {
                const tag = el.tagName;
                const isTool = el.classList.contains('editor-selection-box') ||
                    el.classList.contains('editor-toolbar') ||
                    el.classList.contains('editor-guide') ||
                    el.classList.contains('editor-color-picker');
                return !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(tag) && !isTool;
            });
            if (bodyKids.length >= 1) {
                // If there's only one kid and it contains slides, prefer its children (Strategy 6-like)
                if (bodyKids.length === 1) {
                    const inner = Array.from(bodyKids[0].children).filter(el =>
                        !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)
                    );
                    if (inner.length >= 1) return inner;
                }
                return bodyKids;
            }

            return Array.from(slides); // fallback to whatever last matched
        }

        return { initPreview, findSlides };
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createPreviewLifecycle = createPreviewLifecycle;
})(window);
