(function registerIframeMount(global) {
    'use strict';

    /**
     * @typedef {Object} IframeMountDependencies
     * @property {Object} previewState
     * @property {Object} uiLog
     * @property {Document} document
     * @property {Function} getFindSlides
     * @property {Function} getSetupPreviewInteractions
     * @property {Function} requestAnimationFrame
     * @property {Function} setTimeout
     * @property {Function} getLocalStorage
     */

    /**
     * Creates the existing generated-document mount and readiness polling flow.
     * @param {IframeMountDependencies} deps
     * @returns {(html: string, callback?: Function) => void}
     */
    // eslint-disable-next-line max-lines-per-function -- The returned lifecycle closes over one dependency record.
    function createIframeMount(deps) {
        const { previewState, uiLog, document, requestAnimationFrame, setTimeout } = deps;

        // eslint-disable-next-line max-lines-per-function, complexity -- Keep the iframe lifecycle and fallback ordering intact.
        function initPreview(html, callback) {
            let setupDone = false;

            const doSetup = () => {
                if (setupDone) return;
                // Guard: if called before the HTML is parsed (e.g. triggered by the
                // about:blank load of the freshly-cloned iframe), bail out and let
                // the poll retry — do NOT set setupDone so the real load can win.
                const iDoc = previewState.previewIframe.contentDocument ||
                    (previewState.previewIframe.contentWindow && previewState.previewIframe.contentWindow.document);
                if (!iDoc || !iDoc.body || deps.getFindSlides()(iDoc).length === 0) return;
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
                } catch (e) {
                    // Repaint nudges are best-effort on browsers without animation frames.
                }

                deps.getSetupPreviewInteractions()();
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
                    const theme = document.documentElement.getAttribute('data-theme') || deps.getLocalStorage().getItem('app_theme') || 'dark';
                    if (doc && doc.documentElement) doc.documentElement.setAttribute('data-theme', theme);
                } catch (e) {
                    // ignore
                }
                uiLog.debug('PREVIEW', 'Preview iframe updated with final HTML');
            }

            // Try to detect if already loaded (sync srcdoc or manual write)
            const doc = previewState.previewIframe.contentDocument;
            if (doc && doc.readyState === 'complete' && deps.getFindSlides()(doc).length > 0) {
                setTimeout(doSetup, 50);
            }

            // Fallback: poll until slides appear in the DOM (handles slow CDN or missed onload)
            let attempts = 0;
            const poll = () => {
                if (setupDone) return;
                attempts++;
                // eslint-disable-next-line no-shadow -- Each poll re-reads the iframe document.
                const doc = previewState.previewIframe.contentDocument;
                if (doc && doc.body) {
                    const found = deps.getFindSlides()(doc);
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
                    // Force-complete setup even if the HTML has an unexpected structure
                    // (avoids hanging forever if the HTML has an unexpected structure).
                    if (!setupDone) {
                        setupDone = true;
                        deps.getSetupPreviewInteractions()();
                        if (typeof callback === 'function') callback();
                    }
                }
            };
            setTimeout(poll, 300);
        }

        return initPreview;
    }

    global.AedosPreview = global.AedosPreview || {};
    global.AedosPreview.createIframeMount = createIframeMount;
})(window);
