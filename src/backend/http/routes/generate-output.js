/* eslint-disable max-lines-per-function, complexity */

/**
 * Normalize, validate and sanitize the complete streamed HTML response.
 *
 * @param {{fullHtml: string, usePipeline: boolean, requestId: string, opciones: any, res: any, maxProSlides: number, maxFlashSlides: number, sanitizeGeneratedHtml: Function, injectLayoutSafetyNet: Function, sanitizerLog: any, ErrorCategory: any, isDevelopment: boolean, tmpDir: string, fs: any, path: any, devLog: any, classifyError: Function, extractPresentationTitle: Function, buildFileStemFromTitle: Function, resolveUniqueHtmlPath: Function, examplesFlashDir: string, examplesProDir: string, vendorAssets: {lucide: {url: string, integrity: string}}}} deps
 * @returns {{type: string, html?: string, message?: string}}
 */
function processGeneratedOutput({
    fullHtml,
    usePipeline,
    requestId,
    opciones,
    res,
    maxProSlides,
    maxFlashSlides,
    sanitizeGeneratedHtml,
    injectLayoutSafetyNet,
    sanitizerLog,
    ErrorCategory,
    isDevelopment,
    tmpDir,
    fs,
    path,
    devLog,
    classifyError,
    extractPresentationTitle,
    buildFileStemFromTitle,
    resolveUniqueHtmlPath,
    examplesFlashDir,
    examplesProDir,
    vendorAssets
}) {
    let finalHtml = fullHtml.replace(/^```html\n?/m, '').replace(/^```\n?/m, '').replace(/```\n?$/m, '').trim();
    finalHtml = finalHtml.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '');

    const contentForCheck = finalHtml.toLowerCase();
    let htmlStartIdx = contentForCheck.indexOf('<html');
    if (htmlStartIdx === -1) htmlStartIdx = contentForCheck.indexOf('<style');
    if (htmlStartIdx === -1) htmlStartIdx = contentForCheck.indexOf('<section');
    if (htmlStartIdx === -1) htmlStartIdx = contentForCheck.indexOf('<!--');

    const looksLikeHtml = htmlStartIdx !== -1;
    if (!looksLikeHtml) {
        sanitizerLog.warn(ErrorCategory.VALIDATION, 'Model response was not detected as valid HTML', {
            requestId,
            responseChars: finalHtml.length
        });
        return { type: 'refused', message: finalHtml };
    }

    let cleanedOutput = finalHtml.substring(finalHtml.indexOf('<', htmlStartIdx));
    if (!cleanedOutput.includes('<html') && !cleanedOutput.includes('<head')) {
        cleanedOutput = [
            '<!DOCTYPE html>',
            '<html lang="es">',
            '<head>',
            '<meta charset="UTF-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
            '</head>',
            '<body>',
            cleanedOutput,
            '</body>',
            '</html>'
        ].join('\n');
    }

    const MAX_SLIDES = usePipeline ? maxProSlides : maxFlashSlides;
    const slideTagRe = /<section[^>]*\bclass="[^"]*\bs\b[^"]*"[^>]*>/gi;
    const slideMatches = [...cleanedOutput.matchAll(slideTagRe)];
    if (slideMatches.length > MAX_SLIDES) {
        const cutIndex = slideMatches[MAX_SLIDES].index;
        const bodyClose = cleanedOutput.lastIndexOf('</body>');
        const scripts = bodyClose !== -1 ? cleanedOutput.slice(bodyClose) : '</body></html>';
        cleanedOutput = cleanedOutput.slice(0, cutIndex) + '\n' + scripts;
        sanitizerLog.info(ErrorCategory.SANITIZER, 'Trimmed extra slides in sanitizer', {
            requestId,
            beforeSlides: slideMatches.length,
            maxSlides: MAX_SLIDES
        });
    }

    const overflowScrollRe = /\boverflow-y\s*:\s*(auto|scroll)\b/gi;
    const overflowShorthandRe = /\boverflow\s*:\s*(auto|scroll)\b/gi;
    if (overflowScrollRe.test(cleanedOutput) || overflowShorthandRe.test(cleanedOutput)) {
        cleanedOutput = cleanedOutput.replace(/\boverflow-y\s*:\s*(auto|scroll)\b/gi, 'overflow-y:hidden');
        cleanedOutput = cleanedOutput.replace(/\boverflow\s*:\s*(auto|scroll)\b/gi, 'overflow:hidden');
        sanitizerLog.info(ErrorCategory.SANITIZER, 'Replaced overflow auto/scroll with hidden');
    }

    cleanedOutput = cleanedOutput.replace(
        /(<div\s+class="[^"]*slide-\d+-[^"]*"\s*>)/gi,
        '<div style="flex:1;min-width:0;overflow:hidden;">'
    );

    const looseImportRe = />[ \t\n]*(@import\s+url\([^)]+\);)[ \t\n]*</;
    const looseImport = cleanedOutput.match(looseImportRe);
    if (looseImport) {
        const importLine = looseImport[1];
        cleanedOutput = cleanedOutput.replace(/[ \t\n]*@import\s+url\([^)]+\);[ \t\n]*/gi, '\n');
        cleanedOutput = cleanedOutput.replace(/<style>/i, '<style>\n    ' + importLine);
        sanitizerLog.info(ErrorCategory.SANITIZER, 'Moved loose @import into style block');
    }

    const hasDesignCss = /<style[\s\S]*?section\.s[\s\S]*?<\/style>/i.test(cleanedOutput)
        || /<style[\s\S]*?--bg[\s\S]*?<\/style>/i.test(cleanedOutput);
    if (!hasDesignCss) {
        sanitizerLog.warn(ErrorCategory.SANITIZER, 'Rejected output without design CSS', {
            requestId,
            outputChars: cleanedOutput.length
        });
        res.write(`data: ${JSON.stringify({ error: 'The AI generated a presentation without CSS design. Please try again.' })}\n\n`);
        res.end();
        return { type: 'ended' };
    }

    cleanedOutput = sanitizeGeneratedHtml(cleanedOutput);
    cleanedOutput = injectLayoutSafetyNet(cleanedOutput);

    const lucideSrc = vendorAssets.lucide.url;
    const lucideIntegrity = vendorAssets.lucide.integrity;
    const hasGoogleFontsReference = /fonts\.googleapis\.com/i.test(cleanedOutput);
    const G_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Syne:wght@400..800&family=Archivo+Black&family=Bebas+Neue&family=Bitter:wght@400;700&family=Bricolage+Grotesque:wght@400;700&family=Cinzel:wght@400;700&family=Cormorant+Garamond:wght@400;700&family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Lexend:wght@400;700&family=Lora:wght@400;700&family=Montserrat:wght@400;700&family=Outfit:wght@400;700&family=Playfair+Display:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700&family=Prompt:wght@400;700&family=Sora:wght@400;700&family=Space+Grotesque:wght@400;700&family=Ubuntu:wght@400;700&family=Unbounded:wght@400;700&display=swap" rel="stylesheet">`;
    const headInjectionParts = [];
    if (!hasGoogleFontsReference) headInjectionParts.push(G_FONTS);
    if (!cleanedOutput.includes(lucideSrc)) {
        headInjectionParts.push(`<script src="${lucideSrc}" integrity="${lucideIntegrity}" crossorigin="anonymous"></script>`);
    }
    const headInjection = headInjectionParts.join('\n');

    if (headInjection) {
        if (cleanedOutput.includes('</head>')) {
            cleanedOutput = cleanedOutput.replace(/<\/head>/i, `${headInjection}\n</head>`);
        } else if (cleanedOutput.includes('<head>')) {
            cleanedOutput = cleanedOutput.replace(/<head>/i, `<head>\n${headInjection}`);
        } else {
            cleanedOutput = `${headInjection}\n` + cleanedOutput;
        }
        sanitizerLog.info(ErrorCategory.SANITIZER, 'Injected sanitizer head dependencies', {
            requestId,
            injectedGoogleFonts: !hasGoogleFontsReference,
            injectedLucide: !cleanedOutput.includes(lucideSrc)
        });
    }

    if (!cleanedOutput.includes('lucide-init.js') && !cleanedOutput.includes('lucide.createIcons')) {
        const call = '<script src="/features/shared/lucide-init.js"></script>';
        if (cleanedOutput.includes('</body>')) {
            cleanedOutput = cleanedOutput.replace(/<\/body>/i, `${call}\n</body>`);
        } else {
            cleanedOutput = cleanedOutput + `\n${call}`;
        }
        sanitizerLog.info(ErrorCategory.SANITIZER, 'Injected lucide-init bootstrap script');
    }

    let safetyCloser = "";
    const openComments = (cleanedOutput.match(/<!--/g) || []).length;
    const closedComments = (cleanedOutput.match(/-->/g) || []).length;
    if (openComments > closedComments) safetyCloser += " -->";
    const openSections = (cleanedOutput.match(/<section/g) || []).length;
    const closedSections = (cleanedOutput.match(/<\/section>/g) || []).length;
    if (openSections > closedSections) safetyCloser += "</section>";
    if (!cleanedOutput.includes('</body>')) safetyCloser += "</body>";
    if (!cleanedOutput.includes('</html>')) safetyCloser += "</html>";

    if (safetyCloser) {
        cleanedOutput += safetyCloser;
        sanitizerLog.info(ErrorCategory.SANITIZER, 'Added safety closers to incomplete HTML', {
            requestId,
            closers: safetyCloser
        });
    }

    if (!cleanedOutput.trim().toLowerCase().startsWith('<!doctype html')) {
        cleanedOutput = '<!DOCTYPE html>\n' + cleanedOutput;
    }

    if (isDevelopment) {
        const debugPath = path.join(tmpDir, 'last_generated.html');
        fs.writeFile(debugPath, cleanedOutput, 'utf8', (err) => {
            if (err) {
                devLog.warn(classifyError(err, ErrorCategory.FILESYSTEM), 'Failed to save generated debug HTML', {
                    requestId,
                    error: err
                });
                return;
            }
            devLog.success(ErrorCategory.FILESYSTEM, 'Saved generated debug HTML', {
                requestId,
                path: debugPath
            });
        });

        const titleForFile = extractPresentationTitle(cleanedOutput) || opciones.tema || 'presentation';
        const stem = buildFileStemFromTitle(titleForFile);
        const modeFolder = usePipeline ? 'pro' : 'flash';
        const modeExamplesDir = usePipeline ? examplesProDir : examplesFlashDir;
        const examplePath = resolveUniqueHtmlPath(modeExamplesDir, stem);
        fs.writeFile(examplePath, cleanedOutput, 'utf8', (err) => {
            if (err) {
                devLog.warn(classifyError(err, ErrorCategory.FILESYSTEM), 'Failed to save generated example HTML', {
                    requestId,
                    error: err,
                    title: titleForFile,
                    mode: modeFolder
                });
                return;
            }
            devLog.success(ErrorCategory.FILESYSTEM, 'Saved generated example HTML', {
                requestId,
                path: examplePath,
                title: titleForFile,
                mode: modeFolder
            });
        });
    }

    return { type: 'html', html: cleanedOutput };
}

module.exports = { processGeneratedOutput };
