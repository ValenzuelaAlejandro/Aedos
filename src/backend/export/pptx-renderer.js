// @ts-nocheck
/* eslint-disable no-undef, complexity, max-lines-per-function, max-lines, no-unused-vars, no-shadow */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
    createEditablePptx,
    SLIDE_W_PX,
    SLIDE_H_PX,
    SLIDE_WIDTH,
    SLIDE_HEIGHT,
    TEXT_WIDTH_SAFETY,
    resolveFontFamily,
    createFontWarningCollector,
    compareZKeys,
    parseCssGradient,
    pxToEmu
} = require('../utils/pptx-export');
const { normalizeExportWarning, countExportWarnings } = require('../utils/export-warnings');

/**
 * Creates the unchanged editable-PPTX renderer with its runtime dependencies.
 * The renderer is intentionally kept as one module because splitting its DOM,
 * raster, and package stages would alter observable export timing and warnings.
 */
function createPptxRenderer({ browserManager, port, tmpDir, puppeteerLog, ErrorCategory }) {
    const PORT = port;
    const TMP_DIR = tmpDir;

// Render the edited slide DOM as an editable PowerPoint. Text remains text
// boxes, images remain image objects, and solid fills/borders become shapes.
function normalizePptxFontFamily(fontFace) {
    return resolveFontFamily(fontFace);
}

async function renderEditablePptx(html, title, requestId, { debug = false } = {}) {
    const exportDpr = Math.min(3, Math.max(1, Number(process.env.EXPORT_DPR) || 2));
    if (!browserManager.getBrowser() || !browserManager.getBrowser().isConnected()) {
        await browserManager.initBrowser();
    }
    const browser = browserManager.getBrowser();
    if (!browser) throw new Error('PowerPoint generation is unavailable: the browser could not be started.');

    const metadataTags = `
        <meta name="author" content="Aedos (aedoslab.xyz)">
        <meta name="generator" content="Aedos (aedoslab.xyz)">
        <meta name="creator" content="Aedos (aedoslab.xyz)">
    `;
    let processedHtml = html.replace(/(<head[^>]*>)/i, `$1\n${metadataTags}`);
    const baseTag = `<base href="http://localhost:${PORT}/">`;
    if (!processedHtml.includes('<base')) processedHtml = processedHtml.replace(/(<head[^>]*>)/i, `$1\n${baseTag}`);

    const page = await browser.newPage();
    try {
        await page.setViewport({ width: SLIDE_W_PX, height: SLIDE_H_PX, deviceScaleFactor: exportDpr });
        await page.setContent(processedHtml, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 12000 }).catch(() => {
            puppeteerLog.warn(ErrorCategory.NETWORK, 'PowerPoint export network idle timeout (non-fatal)', { requestId });
        });
        await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
        await page.addStyleTag({ content: `
            *, *::before, *::after { animation: none !important; transition: none !important; }
            .editor-selection-box, .editor-toolbar, .editor-guide, .editor-color-picker, .img-replace-overlay { display: none !important; }
            body { margin: 0 !important; padding: 0 !important; }
        `});
        const assetWarnings = await page.evaluate(async ({ timeoutMs }) => {
            const warnings = [];
            const withTimeout = (promise, label) => new Promise((resolve) => {
                let settled = false;
                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    warnings.push({ asset: label, reason: `timeout after ${timeoutMs}ms` });
                    resolve(false);
                }, timeoutMs);
                Promise.resolve(promise).then(() => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(true);
                }).catch(() => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    warnings.push({ asset: label, reason: 'load/decode failed' });
                    resolve(false);
                });
            });

            await Promise.all(Array.from(document.images).map(async (img) => {
                const label = img.currentSrc || img.src || '<img>';
                if (img.complete && img.naturalWidth > 0) {
                    await withTimeout(img.decode ? img.decode() : Promise.resolve(), label);
                    return;
                }
                await withTimeout(new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve, { once: true });
                    img.addEventListener('error', reject, { once: true });
                }), label);
                if (img.decode) await withTimeout(img.decode(), label);
            }));

            const urls = new Set();
            const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
            document.querySelectorAll('*').forEach((element) => {
                const background = getComputedStyle(element).backgroundImage || '';
                let match;
                while ((match = urlPattern.exec(background))) {
                    if (match[2]) urls.add(match[2]);
                }
            });
            await Promise.all(Array.from(urls).map((url) => withTimeout(new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = resolve;
                image.onerror = reject;
                image.src = url;
                if (image.complete) resolve();
            }), url)));

            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return warnings;
        }, { timeoutMs: 5000 }).catch((error) => {
            puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint export asset readiness check failed (non-fatal)', {
                requestId,
                error: String(error && error.message || error)
            });
            return [];
        });
        assetWarnings.forEach((warning) => {
            puppeteerLog.warn(ErrorCategory.NETWORK, 'PowerPoint export asset warning (non-fatal)', {
                requestId,
                asset: warning.asset,
                reason: warning.reason,
                warning: normalizeExportWarning({ slide: 0, selector: warning.asset, tipo: 'image-load-failed', motivo: warning.reason, fallback: 'omit failed asset and continue' })
            });
        });

        const slideData = await page.evaluate((textWidthSafety) => {
                const textSelector = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,cite,td,th,span,strong,b,em,i,small,mark,a,div';
                const blockTextTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'BLOCKQUOTE', 'CITE']);
                const slides = Array.from(document.querySelectorAll('section.s, section'));
                return slides.map((slide) => {
                    const slideRect = slide.getBoundingClientRect();
                const exportWarnings = [];
                const warningKeys = new Set();
                const relativeRect = (el) => {
                    const rect = el.getBoundingClientRect();
                    return {
                        x: rect.left - slideRect.left,
                        y: rect.top - slideRect.top,
                        w: rect.width,
                        h: rect.height
                    };
                };
                const effectiveOpacity = (el) => {
                    let opacity = 1;
                    let current = el;
                    while (current && current !== slide.parentElement) {
                        opacity *= Number(getComputedStyle(current).opacity || 1);
                        if (current === slide) break;
                        current = current.parentElement;
                    }
                    return Math.max(0, Math.min(1, opacity));
                };
                const colorWithOpacity = (value, opacity) => {
                    const raw = String(value || '').trim();
                    const rgba = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
                    if (rgba) {
                        const alpha = (rgba[4] === undefined ? 1 : Number(rgba[4])) * opacity;
                        return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
                    }
                    if (opacity >= 0.999) return raw;
                    const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
                    if (hex) {
                        const value = hex[1].length === 3
                            ? hex[1].split('').map(part => part + part).join('')
                            : hex[1].slice(0, 6);
                        const alpha = (hex[1].length === 8 ? parseInt(hex[1].slice(6), 16) / 255 : 1) * opacity;
                        return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
                    }
                    return raw;
                };
                const selectorFor = (el) => {
                    const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
                    return `${el.tagName.toLowerCase()}${classes.map(name => `.${name}`).join('')}`;
                };
                const borderInfoFor = (style) => {
                    const sides = ['Top', 'Right', 'Bottom', 'Left'].map(side => ({
                        width: parseFloat(style[`border${side}Width`]) || 0,
                        color: style[`border${side}Color`] || 'transparent',
                        style: style[`border${side}Style`] || 'none'
                    }));
                    const radiusRaw = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => String(style[`border${corner}Radius`] || '0px').trim());
                    const radiusPx = radiusRaw.map(value => parseFloat(value.split(/\s+/)[0]) || 0);
                    const hasRadius = radiusPx.some(value => value > 0);
                    const borderVisible = sides.some(side => side.width > 0 && side.style !== 'none');
                    const borderUniform = sides.every(side => side.width === sides[0].width && side.color === sides[0].color && side.style === sides[0].style);
                    const radiusUniform = radiusPx.every(value => value === radiusPx[0]) && radiusRaw.every(value => value.split(/\s+/).length === 1);
                    const unsupportedStyle = sides.some(side => ['double', 'groove', 'ridge', 'inset', 'outset'].includes(side.style));
                    return { sides, radiusRaw, radiusPx, hasRadius, borderVisible, borderUniform, radiusUniform, unsupportedStyle, distinct: !borderUniform };
                };
                const splitShadowList = (value) => {
                    const parts = [];
                    let current = '';
                    let depth = 0;
                    for (const character of String(value || '')) {
                        if (character === '(') depth++;
                        if (character === ')') depth--;
                        if (character === ',' && depth === 0) {
                            parts.push(current.trim());
                            current = '';
                        } else current += character;
                    }
                    if (current.trim()) parts.push(current.trim());
                    return parts;
                };
                const warnUnsupportedEffects = (el, style) => {
                    const selector = selectorFor(el);
                    const pushWarning = (tipo, motivo, fallback) => {
                        const key = `${tipo}:${selector}:${motivo}`;
                        if (warningKeys.has(key)) return;
                        warningKeys.add(key);
                        exportWarnings.push({ tipo, selector, motivo, fallback });
                    };
                    const shadows = splitShadowList(style.boxShadow).filter(item => item && item !== 'none');
                    if (shadows.length > 1) pushWarning('shadow-fallback', 'múltiples sombras CSS', 'aplicar sombra dominante alpha×blur');
                    if (shadows.some(item => /\binset\b/i.test(item))) pushWarning('shadow-fallback', 'sombra inset no tiene equivalente outerShdw', 'aplicar sombra dominante como outerShdw');
                    if (shadows.some(item => {
                        const withoutColor = item.replace(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|[a-z]+\b/ig, ' ');
                        const numbers = withoutColor.match(/-?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?/gi) || [];
                        return numbers.length >= 4 && Number.parseFloat(numbers[3]) !== 0 && !(Number.parseFloat(numbers[0]) === 0 && Number.parseFloat(numbers[1]) === 0 && Number.parseFloat(numbers[2] || 0) === 0);
                    })) pushWarning('shadow-fallback', 'spread CSS no tiene equivalente directo en outerShdw', 'aproximar con outerShdw sin spread');
                    if (style.filter !== 'none' && /(drop-shadow|blur)\(/i.test(style.filter)) pushWarning('filter-fallback', 'filter CSS no tiene equivalente editable estable', 'rasterizar el nodo completo a PNG');
                    const border = borderInfoFor(style);
                    if (border.unsupportedStyle) pushWarning('border-fallback', 'border-style complejo no tiene equivalente estable', 'conservar color/ancho y usar prstDash solid');
                    if (border.hasRadius && !border.radiusUniform) pushWarning('radius-approx', 'esquinas elípticas o radios distintos', 'roundRect con radio máximo; se rasteriza si también hay lados distintos');
                    if (border.hasRadius && border.distinct) pushWarning('border-fallback', 'lados distintos combinados con border-radius', 'rasterizar nodo completo');
                    if (border.hasRadius && style.overflow === 'hidden' && el.children.length) pushWarning('radius-approx', 'border-radius con overflow hidden contiene hijos', 'rasterizar nodo completo con clipping redondeado');
                    if (parseFloat(style.outlineOffset) !== 0) pushWarning('border-fallback', 'outline-offset no tiene contorno editable equivalente', 'mapear outline al borde del shape conservando el ancho');
                    if (style.visibility === 'hidden') pushWarning('visibility-fallback', 'visibility:hidden elimina el nodo del render', 'omitir el nodo y conservar warning estructurado');
                    if (style.position === 'fixed' || style.position === 'sticky') pushWarning('position-fallback', `position:${style.position} no conserva anclaje entre HTML y slide`, 'exportar como posición absoluta medida en el viewport');
                };
                const filterOwnerFor = (el) => {
                    let current = el;
                    while (current && current !== slide) {
                        const style = getComputedStyle(current);
                        if (style.filter !== 'none' && /(drop-shadow|blur)\(/i.test(style.filter)) return current;
                        current = current.parentElement;
                    }
                    return null;
                };
                const borderRasterOwnerFor = (el) => {
                    let current = el;
                    while (current && current !== slide) {
                        const style = getComputedStyle(current);
                        const border = borderInfoFor(style);
                        if ((border.hasRadius && border.distinct) || (border.hasRadius && style.overflow === 'hidden' && current.children.length)) return current;
                        current = current.parentElement;
                    }
                    return null;
                };
                const rasterOwnerFor = (el) => filterOwnerFor(el) || borderRasterOwnerFor(el);
                const visible = (el, rect) => {
                    const style = getComputedStyle(el);
                    warnUnsupportedEffects(el, style);
                    const intersectsSlide = rect.x < slideRect.width && rect.y < slideRect.height && rect.x + rect.w > 0 && rect.y + rect.h > 0;
                    if (intersectsSlide && Number(style.opacity || 1) > 0 && Number(style.opacity || 1) < 1 && el.children.length) {
                        const key = `opacity:${el.tagName}:${rect.x}:${rect.y}`;
                        if (!warningKeys.has(key)) {
                            warningKeys.add(key);
                            exportWarnings.push({ tipo: 'opacity-group', selector: el.tagName.toLowerCase(), motivo: 'opacity menor que 1 con hijos', fallback: 'alpha por hijo soportado; imágenes conservan el alpha rasterizado' });
                        }
                    }
                    if (intersectsSlide && style.overflow === 'hidden' && el.children.length) {
                        const clipsChild = Array.from(el.children).some(child => {
                            const childRect = relativeRect(child);
                            return childRect.x < rect.x || childRect.y < rect.y || childRect.x + childRect.w > rect.x + rect.w || childRect.y + childRect.h > rect.y + rect.h;
                        });
                        const key = `overflow:${el.tagName}:${rect.x}:${rect.y}`;
                        if (clipsChild && !warningKeys.has(key)) {
                            warningKeys.add(key);
                            exportWarnings.push({ tipo: 'overflow-clipping', selector: el.tagName.toLowerCase(), motivo: 'overflow hidden recorta un hijo', fallback: 'conservar geometría editable y clipping del slide; no rasterizar grupo' });
                        }
                    }
                    return rect.w > 1 && rect.h > 1 && intersectsSlide && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
                };
                const parseZIndex = (style) => {
                    const value = Number(style.zIndex);
                    return Number.isFinite(value) ? value : 0;
                };
                const createsStackingContext = (el, style) => {
                    if (el === slide) return true;
                    if (style.position !== 'static' && style.zIndex !== 'auto') return true;
                    if (Number(style.opacity || 1) < 1) return true;
                    if (style.transform !== 'none' || style.filter !== 'none' || style.isolation === 'isolate') return true;
                    if (/(transform|opacity|filter|perspective|isolation)/i.test(style.willChange || '')) return true;
                    const parentStyle = el.parentElement ? getComputedStyle(el.parentElement) : null;
                    const parentIsFlexOrGrid = parentStyle && /flex|grid/.test(parentStyle.display || '');
                    return Boolean(parentIsFlexOrGrid && style.zIndex !== 'auto');
                };
                const rootContext = { id: 'ctx-0', parent: null, z: 0, domIndex: 0 };
                const orderByElement = new Map([[slide, { domIndex: 0, context: rootContext }]]);
                const pseudoOrder = [];
                let orderCounter = 1;
                let contextCounter = 1;
                const walkPaintOrder = (el, inheritedContext) => {
                    const style = getComputedStyle(el);
                    const domIndex = orderByElement.has(el) ? orderByElement.get(el).domIndex : orderCounter++;
                    const context = el === slide
                        ? rootContext
                        : createsStackingContext(el, style)
                            ? { id: `ctx-${contextCounter++}`, parent: inheritedContext, z: parseZIndex(style), domIndex }
                            : inheritedContext;
                    orderByElement.set(el, { domIndex, context });
                    if (el !== slide) {
                        const before = getComputedStyle(el, '::before');
                        if (before.content && before.content !== 'none' && before.content !== 'normal') {
                            pseudoOrder.push({ el, pseudo: 'before', domIndex: orderCounter++, context });
                        }
                    }
                    Array.from(el.children).forEach(child => walkPaintOrder(child, context));
                    if (el !== slide) {
                        const after = getComputedStyle(el, '::after');
                        if (after.content && after.content !== 'none' && after.content !== 'normal') {
                            pseudoOrder.push({ el, pseudo: 'after', domIndex: orderCounter++, context });
                        }
                    }
                };
                walkPaintOrder(slide, rootContext);
                const zGroup = (z) => z < 0 ? -1 : z > 0 ? 1 : 0;
                const contextChain = (context) => {
                    const chain = [];
                    let current = context;
                    while (current && current !== rootContext) {
                        chain.unshift(current);
                        current = current.parent;
                    }
                    return chain;
                };
                const orderMeta = (el, phase = 2, part = 0) => {
                    const meta = orderByElement.get(el) || { domIndex: orderCounter++, context: rootContext };
                    const elementCreatesContext = meta.context && meta.context.domIndex === meta.domIndex && el !== slide;
                    const key = contextChain(meta.context).flatMap(context => [zGroup(context.z), context.z, context.domIndex]);
                    if (elementCreatesContext) key.push(zGroup(meta.context.z), meta.context.z, meta.context.domIndex);
                    key.push(phase, meta.domIndex, part);
                    return { domIndex: meta.domIndex, zKey: key, contextId: meta.context?.id || rootContext.id };
                };
                const pseudoMeta = (record) => {
                    const key = contextChain(record.context).flatMap(context => [zGroup(context.z), context.z, context.domIndex]);
                    key.push(record.pseudo === 'before' ? 1 : 3, record.domIndex, 0);
                    return { domIndex: record.domIndex, zKey: key, contextId: record.context?.id || rootContext.id };
                };
                const decodePseudoContent = (value) => {
                    const raw = String(value || '').trim();
                    if (!raw || raw === 'none' || raw === 'normal') return '';
                    if (/^(attr|counter|counters|url)\(/i.test(raw) || /^(open-quote|close-quote|no-open-quote|no-close-quote)$/.test(raw)) return null;
                    const quoted = raw.replace(/^(["'])([\s\S]*)\1$/, '$2');
                    return quoted.replace(/\\([0-9a-f]{1,6})\s?/ig, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(["'\\])/g, '$1');
                };
                const inlinePseudoContent = (el, pseudo) => {
                    if (['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'CANVAS', 'SVG'].includes(el.tagName)) return null;
                    const style = getComputedStyle(el, pseudo);
                    const content = decodePseudoContent(style.content || '');
                    if (content === null || !content || style.display === 'none' || style.position !== 'static') return null;
                    if (style.transform !== 'none' || style.filter !== 'none' || style.backdropFilter !== 'none' || style.maskImage !== 'none' || style.mixBlendMode !== 'normal') return null;
                    return { content, style };
                };
                const candidates = Array.from(slide.querySelectorAll(textSelector)).filter((el) => {
                    if (el.closest('table')) return false;
                    const text = (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
                    if (!text) return false;
                    const rect = relativeRect(el);
                    if (!visible(el, rect)) return false;
                    const descendants = Array.from(el.querySelectorAll(textSelector)).filter((child) => {
                        return (child.innerText || child.textContent || '').replace(/\u00a0/g, ' ').trim();
                    });
                    // Inline styling nodes belong to their nearest semantic
                    // block. Exporting both the parent heading and its accent
                    // span would duplicate and overlap words in PowerPoint.
                    let owner = el.parentElement;
                    while (owner && owner !== slide) {
                        if (blockTextTags.has(owner.tagName) && !(el.tagName === 'LI' && owner.tagName === 'LI')) return false;
                        owner = owner.parentElement;
                    }
                    // Keep complete semantic text blocks. Pro slides commonly
                    // style one word with a nested span/strong and use <br> or
                    // block-level labels inside a paragraph. Selecting only the
                    // deepest node splits long titles and drops direct text that
                    // has no child element.
                    // A semantic block owns that full text; generic wrappers do
                    // not, so they are excluded when they contain descendants.
                    if (blockTextTags.has(el.tagName)) return true;
                    return descendants.length === 0;
                });
                const textItems = candidates.flatMap((el) => {
                    // Pro content cards use a block-level <strong> label
                    // followed by paragraph copy. Export them as two editable
                    // text boxes so PowerPoint preserves both the accent color
                    // and the vertical separation.
                    if (el.tagName === 'P') {
                        const labelEl = Array.from(el.querySelectorAll('strong, b')).find((node) => {
                            return getComputedStyle(node).display === 'block';
                        });
                        if (labelEl) {
                            const labelText = (labelEl.innerText || labelEl.textContent || '').replace(/\u00a0/g, ' ').trim();
                            const fullText = (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
                            const bodyText = fullText.replace(labelText, '').trim();
                            const labelRect = relativeRect(labelEl);
                            const bodyRect = relativeRect(el);
                            bodyRect.y = labelRect.y + labelRect.h + 5;
                            bodyRect.h = Math.max(1, bodyRect.h - labelRect.h - 5);
                            return [
                                { el: labelEl, textOverride: labelText, rectOverride: labelRect },
                                { el, textOverride: bodyText, rectOverride: bodyRect }
                            ].filter(item => item.textOverride);
                        }
                    }
                    return [{ el }];
                });

                const transformText = (text, textTransform) => {
                    if (textTransform === 'uppercase') return text.toUpperCase();
                    if (textTransform === 'lowercase') return text.toLowerCase();
                    if (textTransform === 'capitalize') return text.replace(/(^|\s)(\S)/g, (match, prefix, char) => `${prefix}${char.toUpperCase()}`);
                    return text;
                };
                const extractRuns = (root) => {
                    const runs = [];
                    const visit = (node, inherited = {}) => {
                        if (node.nodeType === Node.TEXT_NODE) {
                            const owner = node.parentElement || root;
                            const style = getComputedStyle(owner);
                            let text = node.nodeValue || '';
                            if (style.whiteSpace !== 'pre' && style.whiteSpace !== 'pre-wrap' && style.whiteSpace !== 'break-spaces') {
                                text = text.replace(/\s+/g, ' ');
                            }
                            text = transformText(text, style.textTransform);
                            if (!text) return;
                            runs.push({
                                text,
                                fontFamily: style.fontFamily,
                                sizePx: parseFloat(style.fontSize) || 12,
                                weight: parseInt(style.fontWeight, 10) || 400,
                                italic: style.fontStyle === 'italic',
                                underline: (style.textDecorationLine || '').includes('underline'),
                                strike: (style.textDecorationLine || '').includes('line-through'),
                                color: colorWithOpacity(style.color, effectiveOpacity(owner)),
                                textShadow: style.textShadow !== 'none' ? style.textShadow : null,
                                letterSpacingPx: Number.isFinite(parseFloat(style.letterSpacing)) ? parseFloat(style.letterSpacing) : 0,
                                baseline: style.verticalAlign === 'sub' ? -25000 : style.verticalAlign === 'super' ? 30000 : (inherited.baseline || 0),
                                href: inherited.href || owner.closest('a[href]')?.href || null
                            });
                            return;
                        }
                        if (node.nodeType !== Node.ELEMENT_NODE) return;
                        if (root.tagName === 'LI' && node !== root && node.tagName === 'LI') return;
                        if (node.tagName === 'BR') {
                            const style = getComputedStyle(node.parentElement || root);
                            runs.push({
                                break: true,
                                sizePx: parseFloat(style.fontSize) || 12,
                                fontFamily: style.fontFamily,
                                color: style.color,
                                textShadow: style.textShadow !== 'none' ? style.textShadow : null,
                                weight: parseInt(style.fontWeight, 10) || 400,
                                italic: style.fontStyle === 'italic'
                            });
                            return;
                        }
                        const style = getComputedStyle(node);
                        if (style.display === 'none' || style.visibility === 'hidden') return;
                        const href = node.closest('a[href]')?.href || inherited.href || null;
                        const baseline = style.verticalAlign === 'sub' ? -25000 : style.verticalAlign === 'super' ? 30000 : (inherited.baseline || 0);
                        node.childNodes.forEach(child => visit(child, { href, baseline }));
                    };
                    visit(root);
                    return runs;
                };
                const sliceRunsToText = (runs, targetText) => {
                    if (!targetText) return runs;
                    const plain = runs.filter(run => !run.break).map(run => run.text).join('');
                    const start = plain.indexOf(targetText);
                    if (start < 0) return runs;
                    const end = start + targetText.length;
                    let cursor = 0;
                    return runs.flatMap((run) => {
                        if (run.break) return [];
                        const runStart = cursor;
                        const runEnd = cursor + run.text.length;
                        cursor = runEnd;
                        const from = Math.max(start, runStart);
                        const to = Math.min(end, runEnd);
                        if (from >= to) return [];
                        return [{ ...run, text: run.text.slice(from - runStart, to - runStart) }];
                    });
                };
                const runsToParagraphs = (runs, style, bullet) => {
                    const align = style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : style.textAlign === 'justify' ? 'justify' : 'left';
                    return [{
                        runs,
                        align,
                        lineHeightPx: style.lineHeight === 'normal' ? null : parseFloat(style.lineHeight) || null,
                        lineHeightNormal: style.lineHeight === 'normal',
                        spaceBeforePx: parseFloat(style.marginTop) || 0,
                        spaceAfterPx: parseFloat(style.marginBottom) || 0,
                        bullet
                    }];
                };
                const tableCellModel = (cell) => {
                    const style = getComputedStyle(cell);
                    const rect = relativeRect(cell);
                    const borderSide = (side) => ({
                        width: parseFloat(style[`border${side}Width`]) || 0,
                        color: colorWithOpacity(style[`border${side}Color`], effectiveOpacity(cell)),
                        style: style[`border${side}Style`] || 'solid'
                    });
                    const runs = extractRuns(cell);
                    return {
                        text: (cell.innerText || cell.textContent || '').replace(/\u00a0/g, ' ').trim(),
                        runs,
                        paragraphs: runsToParagraphs(runs, style, null),
                        fill: colorWithOpacity(style.backgroundColor, effectiveOpacity(cell)),
                        fontSize: parseFloat(style.fontSize) || 16,
                        fontFace: (style.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '').trim(),
                        textColor: colorWithOpacity(style.color, effectiveOpacity(cell)),
                        align: style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : 'left',
                        valign: style.verticalAlign === 'middle' ? 'middle' : style.verticalAlign === 'bottom' ? 'bottom' : 'top',
                        padding: { left: parseFloat(style.paddingLeft) || 0, right: parseFloat(style.paddingRight) || 0, top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 },
                        borders: { left: borderSide('Left'), right: borderSide('Right'), top: borderSide('Top'), bottom: borderSide('Bottom') },
                        colSpan: Math.max(1, Number(cell.colSpan) || 1),
                        rowSpan: Math.max(1, Number(cell.rowSpan) || 1),
                        rect
                    };
                };
                const tables = Array.from(slide.querySelectorAll('table')).map((table) => {
                    const rect = relativeRect(table);
                    const rows = Array.from(table.rows);
                    const firstRow = rows[0];
                    const columns = firstRow ? Array.from(firstRow.cells).flatMap(cell => {
                        const span = Math.max(1, Number(cell.colSpan) || 1);
                        return Array.from({ length: span }, () => relativeRect(cell).w / span);
                    }) : [];
                    return {
                        kind: 'table',
                        ...rect,
                        ...orderMeta(table, 1, 0),
                        name: table.getAttribute('aria-label') || table.caption?.textContent?.trim() || 'HTML table',
                        firstRow: Boolean(table.tHead),
                        columns,
                        rows: rows.map(row => ({
                            height: relativeRect(row).h,
                            cells: Array.from(row.cells).map(cell => tableCellModel(cell))
                        })),
                        z: parseInt(getComputedStyle(table).zIndex, 10) || 2
                    };
                }).filter(table => table.w > 1 && table.h > 1);
                const listInfoFor = (el) => {
                    if (el.tagName !== 'LI') return null;
                    const list = el.closest('ul,ol');
                    if (!list) return null;
                    const style = getComputedStyle(el);
                    const listStyle = style.listStyleType || getComputedStyle(list).listStyleType || 'disc';
                    if (listStyle === 'none') return null;
                    let listDepth = 0;
                    let ancestor = el.parentElement;
                    while (ancestor && ancestor !== slide) {
                        if (ancestor.tagName === 'UL' || ancestor.tagName === 'OL') listDepth++;
                        ancestor = ancestor.parentElement;
                    }
                    const isNumbered = list.tagName === 'OL';
                    const numberStyle = ({
                        decimal: 'arabicPeriod',
                        'lower-alpha': 'alphaLcPeriod',
                        'upper-alpha': 'alphaUcPeriod',
                        'lower-roman': 'romanLcPeriod',
                        'upper-roman': 'romanUcPeriod'
                    })[listStyle] || 'arabicPeriod';
                    const marker = getComputedStyle(el, '::marker');
                    const markerContent = (marker.content || '').replace(/^['"]|['"]$/g, '').trim();
                    const start = Number(list.getAttribute('start')) || 1;
                    const reversed = list.hasAttribute('reversed');
                    const position = Array.from(list.children).filter(child => child.tagName === 'LI').indexOf(el) + 1;
                    return {
                        type: isNumbered ? 'number' : 'char',
                        style: numberStyle,
                        char: markerContent && !/^normal|auto$/i.test(markerContent) ? markerContent : '•',
                        level: Math.max(0, listDepth - 1),
                        marginLeftPx: parseFloat(getComputedStyle(list).paddingLeft) || parseFloat(style.paddingLeft) || 0,
                        startAt: isNumbered
                            ? (reversed ? Math.max(start, list.querySelectorAll(':scope > li').length) - position + 1 : start + position - 1)
                            : null,
                        reversed
                    };
                };

                const texts = textItems.map(({ el, textOverride, rectOverride }) => {
                    const style = getComputedStyle(el);
                    const rect = rectOverride || relativeRect(el);
                    const text = (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
                    const listBullet = listInfoFor(el);
                    const beforePseudo = inlinePseudoContent(el, '::before');
                    const afterPseudo = inlinePseudoContent(el, '::after');
                    const pseudoSpacing = (pixels, sizePx) => {
                        const count = Math.max(1, Math.round((parseFloat(pixels) || 0) / Math.max(1, sizePx * 0.28)));
                        return '\u00a0'.repeat(count);
                    };
                    const pseudoRun = (entry, side) => entry ? {
                        text: side === 'before'
                            ? `${entry.content}${pseudoSpacing(entry.style.marginRight, parseFloat(entry.style.fontSize) || parseFloat(style.fontSize) || 12)}`
                            : `${pseudoSpacing(entry.style.marginLeft, parseFloat(entry.style.fontSize) || parseFloat(style.fontSize) || 12)}${entry.content}`,
                        fontFamily: entry.style.fontFamily,
                        sizePx: parseFloat(entry.style.fontSize) || parseFloat(style.fontSize) || 12,
                        weight: parseInt(entry.style.fontWeight, 10) || 400,
                        italic: entry.style.fontStyle === 'italic',
                        underline: (entry.style.textDecorationLine || '').includes('underline'),
                        strike: (entry.style.textDecorationLine || '').includes('line-through'),
                        color: colorWithOpacity(entry.style.color, effectiveOpacity(el)),
                        textShadow: entry.style.textShadow !== 'none' ? entry.style.textShadow : null,
                        letterSpacingPx: Number.isFinite(parseFloat(entry.style.letterSpacing)) ? parseFloat(entry.style.letterSpacing) : 0,
                        baseline: 0,
                        href: el.closest('a[href]')?.href || null
                    } : null;
                    const resolvedText = `${beforePseudo ? `${beforePseudo.content}${pseudoSpacing(beforePseudo.style.marginRight, parseFloat(beforePseudo.style.fontSize) || parseFloat(style.fontSize) || 12)}` : ''}${(textOverride || text).replace(listBullet ? /^[•◦▪●]\s*/ : /^/, '')}${afterPseudo ? `${pseudoSpacing(afterPseudo.style.marginLeft, parseFloat(afterPseudo.style.fontSize) || parseFloat(style.fontSize) || 12)}${afterPseudo.content}` : ''}`;
                    const runs = [pseudoRun(beforePseudo, 'before'), ...sliceRunsToText(extractRuns(el), textOverride || ''), pseudoRun(afterPseudo, 'after')].filter(Boolean);
                    const isHeading = /^H[1-6]$/.test(el.tagName);
                    if (isHeading) {
                        // Web fonts can be narrower than their Office fallback.
                        // Keep explicit <br> line breaks, but give PowerPoint
                        // enough horizontal room to avoid rewrapping fragments.
                        rect.w = Math.max(rect.w, Math.max(1, slideRect.width - rect.x - 40));
                    }
                    let fontSize = parseFloat(style.fontSize) || 12;
                    if (/^H[2-6]$/.test(el.tagName) && resolvedText.length > 24) {
                        // Long Pro headings should stay on one readable line in
                        // the editable deck instead of overflowing the right
                        // edge or colliding with the subtitle below.
                        const availableWidth = Math.max(120, slideRect.width - rect.x - 40);
                        fontSize = Math.min(fontSize, availableWidth / (resolvedText.length * 0.52));
                    }
                    const before = getComputedStyle(el, '::before');
                    const beforeContent = before.content || '';
                    const beforeWidth = parseFloat(before.width) || 0;
                    const beforeGap = parseFloat(style.columnGap || style.gap) || 0;
                    if (beforeContent && beforeContent !== 'none' && beforeContent !== 'normal' && beforeWidth > 1 && style.display.includes('flex')) {
                        rect.x += beforeWidth + beforeGap;
                        rect.w = Math.max(1, rect.w - beforeWidth - beforeGap);
                    }
                    const lineHeightPx = style.lineHeight === 'normal'
                        ? fontSize * 1.2
                        : (parseFloat(style.lineHeight) || fontSize * 1.2);
                    const normalizedLength = resolvedText.replace(/\s+/g, ' ').trim().length;
                    const estimatedCharsPerLine = Math.max(1, rect.w / Math.max(1, fontSize * 0.52));
                    const estimatedLines = Math.max(1, Math.ceil(normalizedLength / estimatedCharsPerLine));
                    const domLooksSingleLine = style.whiteSpace === 'nowrap' || rect.h <= lineHeightPx * 1.35;
                    if (!domLooksSingleLine) {
                        rect.h = Math.max(rect.h, estimatedLines * lineHeightPx * 1.08);
                    }
                    // Keep the DOM anchor stable while giving PowerPoint a small
                    // metric-safety margin. Center/right aligned boxes expand
                    // around their alignment axis instead of shifting the text.
                    const widthDelta = Math.max(0, rect.w * (textWidthSafety - 1));
                    if (style.textAlign === 'center') {
                        rect.x -= widthDelta / 2;
                        rect.w += widthDelta;
                    } else if (style.textAlign === 'right') {
                        rect.x -= widthDelta;
                        rect.w += widthDelta;
                    } else {
                        rect.w += widthDelta;
                    }
                    return {
                        ...rect,
                        kind: 'text',
                        ...orderMeta(el, 2, 1),
                        selector: `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`,
                        text: resolvedText,
                        runs,
                        paragraphs: runsToParagraphs(runs, style, listBullet),
                        fontSize,
                        fontFace: (style.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '').trim(),
                        textColor: colorWithOpacity(style.color, effectiveOpacity(el)),
                        bold: parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === 'bold',
                        italic: style.fontStyle === 'italic',
                        bullet: listBullet,
                        align: style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : 'left',
                        valign: style.display === 'flex' && style.alignItems === 'center' ? 'middle' : 'top',
                        noWrap: domLooksSingleLine,
                        textShadow: style.textShadow !== 'none' ? style.textShadow : null,
                        filter: style.filter !== 'none' ? style.filter : null,
                        rasterize: Boolean(rasterOwnerFor(el)),
                        shadowOpacity: effectiveOpacity(el),
                        paragraphGap: false,
                        z: parseInt(style.zIndex, 10) || 10
                    };
                });
                const shapes = Array.from(slide.querySelectorAll('*')).filter((el) => {
                    if (el.tagName === 'IMG' || el.tagName === 'SVG' || el === slide || el.closest('table')) return false;
                    const style = getComputedStyle(el);
                    const rect = relativeRect(el);
                    const border = borderInfoFor(style);
                    const hasFill = style.backgroundColor && style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
                    const hasBorder = border.borderVisible || (parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none');
                    const hasShadow = style.boxShadow && style.boxShadow !== 'none';
                    const hasFilter = style.filter !== 'none' && /(drop-shadow|blur)\(/i.test(style.filter);
                    return visible(el, rect) && (hasFill || hasBorder || hasShadow || hasFilter);
                }).map((el) => {
                    const style = getComputedStyle(el);
                    const rect = relativeRect(el);
                    const border = borderInfoFor(style);
                    const outlineWidth = parseFloat(style.outlineWidth) || 0;
                    const useOutline = !border.borderVisible && outlineWidth > 0 && style.outlineStyle !== 'none';
                    return {
                        ...rect,
                        kind: 'shape',
                        ...orderMeta(el, 0, 0),
                        fill: colorWithOpacity(style.backgroundColor, effectiveOpacity(el)),
                        fillOpacity: effectiveOpacity(el),
                        borderColor: colorWithOpacity(useOutline ? style.outlineColor : style.borderTopColor, effectiveOpacity(el)),
                        gradient: style.backgroundImage && style.backgroundImage !== 'none' ? style.backgroundImage : null,
                        borderWidth: useOutline ? outlineWidth : (parseFloat(style.borderTopWidth) || 0),
                        borderStyle: useOutline ? style.outlineStyle : (border.borderUniform ? border.sides[0].style : 'solid'),
                        outlineOffset: parseFloat(style.outlineOffset) || 0,
                        borderRadius: parseFloat(style.borderTopLeftRadius) || 0,
                        shadow: style.boxShadow !== 'none' ? style.boxShadow : null,
                        shadowOpacity: effectiveOpacity(el),
                        filter: style.filter !== 'none' ? style.filter : null,
                        rasterize: Boolean(rasterOwnerFor(el)),
                        widthPx: rect.w,
                        heightPx: rect.h,
                        borderInfo: border,
                        borderSides: border.sides.map(side => ({ ...side, color: colorWithOpacity(side.color, effectiveOpacity(el)) })),
                        borderCompensate: !useOutline && border.borderUniform && border.sides[0].width > 0,
                        borderRadiusPx: parseFloat(style.borderTopLeftRadius) || 0,
                        radiusUniform: borderInfoFor(style).radiusUniform,
                        geometryType: borderInfoFor(style).radiusUniform && borderInfoFor(style).radiusPx[0] >= Math.min(rect.w, rect.h) / 2 && Math.abs(rect.w - rect.h) < 0.5 ? 'ellipse' : (borderInfoFor(style).hasRadius ? 'roundRect' : 'rect'),
                        z: parseInt(style.zIndex, 10) || 0
                    };
                });
                const images = Array.from(slide.querySelectorAll('img')).map((el) => {
                    const rect = relativeRect(el);
                    const style = getComputedStyle(el);
                    const objectFit = style.objectFit || 'fill';
                    const objectPosition = style.objectPosition || '50% 50%';
                    const naturalWidth = el.naturalWidth || 0;
                    const naturalHeight = el.naturalHeight || 0;
                    let crop = null;
                    if (objectFit === 'cover' && naturalWidth > 0 && naturalHeight > 0 && rect.w > 0 && rect.h > 0) {
                        const sourceRatio = naturalWidth / naturalHeight;
                        const boxRatio = rect.w / rect.h;
                        if (sourceRatio > boxRatio) {
                            const visibleRatio = boxRatio / sourceRatio;
                            const position = parseFloat(objectPosition) / 100 || .5;
                            const left = (1 - visibleRatio) * position;
                            crop = { l: left * 100000, r: (1 - left - visibleRatio) * 100000, t: 0, b: 0 };
                        } else if (sourceRatio < boxRatio) {
                            const visibleRatio = sourceRatio / boxRatio;
                            const position = parseFloat(String(objectPosition).split(/\s+/)[1] || objectPosition) / 100 || .5;
                            const top = (1 - visibleRatio) * position;
                            crop = { l: 0, r: 0, t: top * 100000, b: (1 - top - visibleRatio) * 100000 };
                        }
                    }
                    return { ...rect, kind: 'image', ...orderMeta(el, 2, 2), opacity: effectiveOpacity(el), rasterize: Boolean(rasterOwnerFor(el)), objectFit, objectPosition, crop, src: el.currentSrc || el.src || '', naturalWidth, naturalHeight, descr: (el.alt || el.getAttribute('aria-label') || el.getAttribute('role') === 'presentation') ? (el.alt || el.getAttribute('aria-label') || '') : '', visible: visible(el, rect), z: parseInt(style.zIndex, 10) || 5 };
                }).filter(image => image.visible);
                const svgs = Array.from(slide.querySelectorAll('svg')).map((el) => {
                    const rect = relativeRect(el);
                    const style = getComputedStyle(el);
                    return { ...rect, kind: 'image', ...orderMeta(el, 2, 2), opacity: effectiveOpacity(el), rasterize: Boolean(rasterOwnerFor(el)), visible: visible(el, rect), z: parseInt(style.zIndex, 10) || 5 };
                }).filter(svg => svg.visible);
                const canvases = Array.from(slide.querySelectorAll('canvas')).map((el) => {
                    const rect = relativeRect(el);
                    const style = getComputedStyle(el);
                    return { ...rect, kind: 'image', ...orderMeta(el, 2, 2), opacity: effectiveOpacity(el), rasterize: false, src: '', descr: el.getAttribute('aria-label') || '', visible: visible(el, rect), z: parseInt(style.zIndex, 10) || 5 };
                }).filter(canvas => canvas.visible);
                const backgroundElements = Array.from(slide.querySelectorAll('*')).map((el, index) => {
                    if (el.closest('table')) return null;
                    const rect = relativeRect(el);
                    const style = getComputedStyle(el);
                    const gradientColor = (style.backgroundImage || '').match(/(?:rgba?\([^)]*\)|#[0-9a-f]{3,8})/i)?.[0] || style.backgroundColor;
                    return {
                        index,
                        kind: 'shape',
                        ...orderMeta(el, 0, 0),
                        ...rect,
                        backgroundImage: style.backgroundImage,
                        gradientColor,
                        fillOpacity: effectiveOpacity(el),
                        filter: style.filter !== 'none' ? style.filter : null,
                        rasterize: Boolean(rasterOwnerFor(el)),
                        borderInfo: borderInfoFor(style),
                        borderRadiusPx: parseFloat(style.borderTopLeftRadius) || 0,
                        borderRadius: parseFloat(style.borderTopLeftRadius) || 0,
                        visible: visible(el, rect),
                        z: parseInt(style.zIndex, 10) || 1
                    };
                }).filter(item => item && item.visible && item.backgroundImage && item.backgroundImage !== 'none');
                const pseudoDecorations = pseudoOrder.map((record) => {
                    const el = record.el;
                    const parentRect = relativeRect(el);
                    const pseudo = `::${record.pseudo}`;
                    const pseudoIndex = record.pseudo === 'after' ? 1 : 0;
                    {
                        const style = getComputedStyle(el, pseudo);
                        const content = style.content || '';
                        const decodedContent = decodePseudoContent(content);
                        if (decodedContent === null) {
                            exportWarnings.push({ tipo: 'pseudo-fallback', selector: `${selectorFor(el)}${pseudo}`, motivo: `content no editable: ${content}`, fallback: 'omitir pseudo y conservar warning; rasterización aislada no fiable' });
                            return null;
                        }
                        if (inlinePseudoContent(el, pseudo)) return null;
                        if (style.transform !== 'none' || style.filter !== 'none' || style.backdropFilter !== 'none' || style.maskImage !== 'none' || style.mixBlendMode !== 'normal') {
                            exportWarnings.push({ tipo: 'pseudo-fallback', selector: `${selectorFor(el)}${pseudo}`, motivo: 'pseudo con transform/filter/mask/blend no tiene captura aislada estable', fallback: 'omitir pseudo y conservar el contenido editable del padre' });
                            return null;
                        }
                        const width = parseFloat(style.width) || 0;
                        const fontSize = parseFloat(style.fontSize) || 16;
                        const lineHeight = style.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(style.lineHeight) || fontSize * 1.2;
                        const measuredWidth = decodedContent ? Math.max(1, decodedContent.length * fontSize * 0.55) : 0;
                        const height = parseFloat(style.height) || (decodedContent ? lineHeight : 0);
                        const pseudoWidth = width || measuredWidth;
                        const fill = style.backgroundColor && style.backgroundColor !== 'transparent'
                            ? style.backgroundColor
                            : ((style.backgroundImage || '').match(/(?:rgba?\([^)]*\)|#[0-9a-f]{3,8})/i)?.[0] || 'transparent');
                        if (!visible(el, parentRect) || (decodedContent === '' && fill === 'transparent') || pseudoWidth <= 0 || height <= 0) return null;
                        const isText = Boolean(decodedContent);
                        const position = style.position;
                        let positionedAncestor = null;
                        if (position === 'absolute' || position === 'fixed') {
                            let ancestor = el.parentElement;
                            while (ancestor && ancestor !== slide) {
                                if (getComputedStyle(ancestor).position !== 'static') { positionedAncestor = ancestor; break; }
                                ancestor = ancestor.parentElement;
                            }
                            positionedAncestor ||= slide;
                        }
                        const ancestorRect = positionedAncestor ? relativeRect(positionedAncestor) : parentRect;
                        const left = parseFloat(style.left);
                        const top = parseFloat(style.top);
                        const x = positionedAncestor && Number.isFinite(left) ? ancestorRect.x + (parseFloat(getComputedStyle(positionedAncestor).paddingLeft) || 0) + left : parentRect.x + (pseudoIndex === 1 && !isText ? Math.max(0, parentRect.w - pseudoWidth) : 0);
                        const y = positionedAncestor && Number.isFinite(top) ? ancestorRect.y + (parseFloat(getComputedStyle(positionedAncestor).paddingTop) || 0) + top : parentRect.y + (isText ? 0 : Math.max(0, (parentRect.h - height) / 2));
                        return {
                            kind: isText ? 'text' : 'shape',
                            ...pseudoMeta(record),
                            x,
                            y,
                            w: pseudoWidth,
                            h: height,
                            fill: fill === 'transparent' ? 'transparent' : colorWithOpacity(fill, effectiveOpacity(el)),
                            fillOpacity: effectiveOpacity(el),
                            gradient: style.backgroundImage && style.backgroundImage !== 'none' ? style.backgroundImage : null,
                            text: isText ? decodedContent : undefined,
                            textColor: colorWithOpacity(style.color, effectiveOpacity(el)),
                            fontSize,
                            fontFace: (style.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '').trim(),
                            align: style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : 'left',
                            noWrap: true,
                            paragraphs: isText ? [{ text: decodedContent, runs: [{ text: decodedContent, fontFamily: style.fontFamily, sizePx: fontSize, weight: parseInt(style.fontWeight, 10) || 400, italic: style.fontStyle === 'italic', color: colorWithOpacity(style.color, effectiveOpacity(el)), textShadow: style.textShadow !== 'none' ? style.textShadow : null }], align: style.textAlign || 'left', lineHeightPx: lineHeight }] : undefined,
                            shadow: style.boxShadow !== 'none' ? style.boxShadow : null,
                            filter: style.filter !== 'none' ? style.filter : null,
                            rasterize: Boolean(rasterOwnerFor(el)),
                            borderRadius: parseFloat(style.borderTopLeftRadius) || 0,
                            z: parseInt(getComputedStyle(el).zIndex, 10) || 1,
                            name: `${record.pseudo === 'before' ? 'Before' : 'After'} ${selectorFor(el)}`
                        };
                    }
                }).filter(Boolean);
                const filteredElements = Array.from(slide.querySelectorAll('*')).map((el) => {
                    const style = getComputedStyle(el);
                    const rect = relativeRect(el);
                    const owner = rasterOwnerFor(el);
                    if (owner !== el || !visible(el, rect)) return null;
                    const isFilter = style.filter !== 'none' && /(drop-shadow|blur)\(/i.test(style.filter);
                    const border = borderInfoFor(style);
                    const isRadiusFallback = border.hasRadius && (border.distinct || (style.overflow === 'hidden' && el.children.length));
                    if (!isFilter && !isRadiusFallback) return null;
                    return { ...rect, kind: 'image', ...orderMeta(el, 2, 2), opacity: 1, z: parseInt(style.zIndex, 10) || 5, name: `${isFilter ? 'Rasterized filter' : 'Rasterized border'} ${selectorFor(el)}` };
                }).filter(Boolean);
                const style = getComputedStyle(slide);
                return {
                    left: slideRect.left,
                    top: slideRect.top,
                    width: slideRect.width,
                    height: slideRect.height,
                    background: style.backgroundColor,
                    texts,
                    shapes,
                    images,
                    svgs,
                    canvases,
                    backgroundElements,
                    pseudoDecorations,
                    filteredElements,
                    tables,
                    warnings: exportWarnings
                };
            }).filter(slide => slide.width > 10 && slide.height > 10);
        }, TEXT_WIDTH_SAFETY);
        if (!slideData.length) {
            const error = new Error('HTML contract violation: no exportable section.s/section slide was found');
            error.code = 'CONTRACT_VIOLATION';
            throw error;
        }

        const slides = [];
        slideData.forEach((model, slideIndex) => {
            model.warnings = (model.warnings || []).map(warning => normalizeExportWarning(warning, slideIndex + 1));
            model.warnings.forEach((warning) => {
                puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint export fallback decision (non-fatal)', {
                    requestId,
                    warning: { ...warning, slide: slideIndex + 1 }
                });
            });
        });
        for (let slideIndex = 0; slideIndex < slideData.length; slideIndex++) {
            const model = slideData[slideIndex];
            const scaleRect = (item) => ({
                ...item,
                x: pxToEmu(item.x * SLIDE_W_PX / model.width, 'x') + (item.borderCompensate ? pxToEmu((item.borderWidth / 2) * SLIDE_W_PX / model.width, 'x') : 0),
                y: pxToEmu(item.y * SLIDE_H_PX / model.height, 'y') + (item.borderCompensate ? pxToEmu((item.borderWidth / 2) * SLIDE_H_PX / model.height, 'y') : 0),
                w: pxToEmu(item.w * SLIDE_W_PX / model.width, 'x') - (item.borderCompensate ? pxToEmu(item.borderWidth * SLIDE_W_PX / model.width, 'x') : 0),
                h: pxToEmu(item.h * SLIDE_H_PX / model.height, 'y') - (item.borderCompensate ? pxToEmu(item.borderWidth * SLIDE_H_PX / model.height, 'y') : 0)
            });
                const images = [];
                let backgroundImage = null;
                const backgroundClip = await page.evaluate((slideIndex) => {
                    const slide = document.querySelectorAll('section.s, section')[slideIndex];
                    if (!slide) return null;
                    const style = getComputedStyle(slide);
                    if (!style.backgroundImage || style.backgroundImage === 'none') return null;
                    const rect = slide.getBoundingClientRect();
                    const clone = slide.cloneNode(true);
                    slide.setAttribute('data-aedos-background-source-style', slide.getAttribute('style') || '');
                    slide.style.visibility = 'hidden';
                    slide.setAttribute('data-aedos-background-source-hidden', 'true');
                    clone.setAttribute('data-aedos-background-clone', 'true');
                    clone.style.visibility = 'visible';
                    clone.style.position = 'fixed';
                    clone.style.left = `${rect.left}px`;
                    clone.style.top = `${rect.top}px`;
                    clone.style.width = `${rect.width}px`;
                    clone.style.height = `${rect.height}px`;
                    clone.style.margin = '0';
                    // Capture the clone above the document background. A negative
                    // z-index makes the screenshot contain only body/slide paint.
                    clone.style.zIndex = '2147483647';
                    clone.style.pointerEvents = 'none';
                    clone.querySelectorAll('*').forEach((element) => {
                        element.style.visibility = 'hidden';
                    });
                    document.body.appendChild(clone);
                    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                }, slideIndex);
                if (backgroundClip) {
                    const data = await page.screenshot({
                        type: 'png',
                        clip: {
                            x: Math.max(0, backgroundClip.left),
                            y: Math.max(0, backgroundClip.top),
                            width: Math.max(1, backgroundClip.width),
                            height: Math.max(1, backgroundClip.height)
                        },
                        captureBeyondViewport: true
                    });
                    backgroundImage = {
                        x: 0,
                        y: 0,
                        w: SLIDE_WIDTH,
                        h: SLIDE_HEIGHT,
                        data,
                        name: `Slide ${slideIndex + 1} background`
                    };
                    await page.evaluate(() => {
                        document.querySelector('[data-aedos-background-clone]')?.remove();
                        const source = document.querySelector('[data-aedos-background-source-hidden]');
                        if (source) {
                            source.setAttribute('style', source.getAttribute('data-aedos-background-source-style') || '');
                            source.removeAttribute('data-aedos-background-source-style');
                            source.removeAttribute('data-aedos-background-source-hidden');
                        }
                    });
                }
                const backgroundFallbacks = new Set();
                const isNativeGradient = (item) => {
                    if (!item.backgroundImage || item.backgroundImage === 'none' || /url\(/i.test(item.backgroundImage)) return false;
                    return Boolean(parseCssGradient(item.backgroundImage, { width: item.w, height: item.h }));
                };
                const decorativeShapes = [
                    ...model.backgroundElements
                        .filter((item) => {
                            if (item.rasterize) return false;
                            if (/url\(/i.test(item.backgroundImage || '')) return false;
                            const native = isNativeGradient(item);
                            if (!native && item.backgroundImage) backgroundFallbacks.add(item);
                            return native && item.gradientColor;
                        })
                        .map((item) => ({ ...item, fill: item.gradientColor, gradient: item.backgroundImage, borderColor: 'transparent', borderWidth: 0 })),
                    ...model.pseudoDecorations.filter(item => item.kind !== 'text').map((item) => ({ ...item, borderColor: 'transparent', borderWidth: 0 }))
                ];
                const sideBorderShapes = model.shapes.flatMap((shape) => {
                    const border = shape.borderInfo;
                    if (!border || border.borderUniform || border.hasRadius || shape.rasterize || !border.borderVisible) return [];
                    const [top, right, bottom, left] = shape.borderSides || border.sides;
                    const sides = [];
                    const base = { kind: 'shape', borderColor: 'transparent', borderWidth: 0, borderStyle: 'solid', borderRadiusPx: 0, geometryType: 'rect', zKey: shape.zKey, domIndex: shape.domIndex, contextId: shape.contextId };
                    if (top.width > 0) sides.push({ ...base, x: shape.x, y: shape.y, w: shape.w, h: top.width, fill: top.color, name: `${shape.name || 'Shape'} border-top` });
                    if (bottom.width > 0) sides.push({ ...base, x: shape.x, y: shape.y + shape.h - bottom.width, w: shape.w, h: bottom.width, fill: bottom.color, name: `${shape.name || 'Shape'} border-bottom` });
                    const middleY = shape.y + top.width;
                    const middleH = Math.max(0, shape.h - top.width - bottom.width);
                    if (left.width > 0 && middleH > 0) sides.push({ ...base, x: shape.x, y: middleY, w: left.width, h: middleH, fill: left.color, name: `${shape.name || 'Shape'} border-left` });
                    if (right.width > 0 && middleH > 0) sides.push({ ...base, x: shape.x + shape.w - right.width, y: middleY, w: right.width, h: middleH, fill: right.color, name: `${shape.name || 'Shape'} border-right` });
                    return sides;
                });
                for (let backgroundIndex = 0; backgroundIndex < model.backgroundElements.length; backgroundIndex++) {
                    const backgroundElement = model.backgroundElements[backgroundIndex];
                    const shouldRasterize = !backgroundElement.rasterize && (/url\(/i.test(backgroundElement.backgroundImage || '') || backgroundFallbacks.has(backgroundElement));
                    if (!shouldRasterize) continue;
                    const elementClip = await page.evaluate(({ slideIndex: currentSlide, elementIndex }) => {
                        const slide = document.querySelectorAll('section.s, section')[currentSlide];
                        if (!slide) return null;
                        const candidates = Array.from(slide.querySelectorAll('*')).filter((element) => {
                            const style = getComputedStyle(element);
                            return style.backgroundImage && style.backgroundImage !== 'none';
                        });
                        const element = candidates[elementIndex];
                        if (!element) return null;
                        const rect = element.getBoundingClientRect();
                        const clone = element.cloneNode(true);
                        element.setAttribute('data-aedos-background-source-style', element.getAttribute('style') || '');
                        element.style.visibility = 'hidden';
                        element.setAttribute('data-aedos-background-source-hidden', 'true');
                        clone.setAttribute('data-aedos-background-clone', 'true');
                        clone.style.visibility = 'visible';
                        clone.style.position = 'fixed';
                        clone.style.left = `${rect.left}px`;
                        clone.style.top = `${rect.top}px`;
                        clone.style.width = `${rect.width}px`;
                        clone.style.height = `${rect.height}px`;
                        clone.style.margin = '0';
                        // A background-only clone must not carry the element's
                        // direct text node; the text is exported separately as
                        // an editable shape and would otherwise be duplicated.
                        clone.style.color = 'transparent';
                        // Keep unsupported background regions above the page while
                        // their original element is hidden for the clip capture.
                        clone.style.zIndex = '2147483647';
                        clone.style.pointerEvents = 'none';
                        clone.querySelectorAll('*').forEach((child) => {
                            child.style.visibility = 'hidden';
                        });
                        document.body.appendChild(clone);
                        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                    }, { slideIndex, elementIndex: backgroundIndex });
                    if (!elementClip) continue;
                    const data = await page.screenshot({
                        type: 'png',
                        clip: {
                            x: Math.max(0, elementClip.left),
                            y: Math.max(0, elementClip.top),
                            width: Math.max(1, elementClip.width),
                            height: Math.max(1, elementClip.height)
                        },
                        captureBeyondViewport: true
                    });
                    images.push({
                        ...scaleRect(backgroundElement),
                        kind: 'image',
                        data,
                        rasterize: false,
                        z: backgroundElement.z,
                        name: `Slide ${slideIndex + 1} background region ${backgroundIndex + 1}`
                    });
                    if (backgroundFallbacks.has(backgroundElement)) {
                        puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint gradient fallback (non-fatal)', {
                            requestId,
                            warning: {
                                slide: slideIndex + 1,
                                selector: backgroundElement.selector || backgroundElement.name || 'background',
                                tipo: 'gradient-fallback',
                                motivo: 'gradiente CSS no representable como fill nativo',
                                fallback: 'rasterized-region'
                            }
                        });
                    }
                    await page.evaluate(() => {
                        document.querySelector('[data-aedos-background-clone]')?.remove();
                        const source = document.querySelector('[data-aedos-background-source-hidden]');
                        if (source) {
                            source.setAttribute('style', source.getAttribute('data-aedos-background-source-style') || '');
                            source.removeAttribute('data-aedos-background-source-style');
                            source.removeAttribute('data-aedos-background-source-hidden');
                        }
                    });
                }
                for (let imageIndex = 0; imageIndex < model.images.length; imageIndex++) {
                const image = model.images[imageIndex];
                const absolute = {
                    x: Math.max(0, model.left + image.x),
                    y: Math.max(0, model.top + image.y),
                    width: Math.max(1, image.w),
                    height: Math.max(1, image.h)
                };
                // Capture the already-rendered node. Reconstructing a cover image
                // from its source loses object-position and can produce a different
                // crop in Chromium/PowerPoint, so the screenshot is the source of
                // truth for visual fidelity. The native srcRect mapping remains
                // covered by the exporter unit tests for callers that provide it.
                const data = await page.screenshot({ type: 'png', clip: absolute, captureBeyondViewport: true });
                images.push({
                    ...scaleRect(image),
                    crop: null,
                    kind: 'image',
                    data,
                    rasterize: false,
                    name: `Slide ${slideIndex + 1} image ${imageIndex + 1}`
                });
                }
                for (let svgIndex = 0; svgIndex < model.svgs.length; svgIndex++) {
                    const svg = model.svgs[svgIndex];
                    const absolute = {
                        x: Math.max(0, model.left + svg.x),
                        y: Math.max(0, model.top + svg.y),
                        width: Math.max(1, svg.w),
                        height: Math.max(1, svg.h)
                    };
                    const data = await page.screenshot({ type: 'png', clip: absolute, captureBeyondViewport: true });
                    images.push({ ...scaleRect(svg), kind: 'image', data, rasterize: false, name: `Slide ${slideIndex + 1} icon ${svgIndex + 1}` });
                }
                for (let canvasIndex = 0; canvasIndex < (model.canvases || []).length; canvasIndex++) {
                    const canvas = model.canvases[canvasIndex];
                    const absolute = { x: Math.max(0, model.left + canvas.x), y: Math.max(0, model.top + canvas.y), width: Math.max(1, canvas.w), height: Math.max(1, canvas.h) };
                    const data = await page.screenshot({ type: 'png', clip: absolute, captureBeyondViewport: true });
                    images.push({ ...scaleRect(canvas), kind: 'image', data, rasterize: false, descr: canvas.descr || '', name: `Slide ${slideIndex + 1} canvas ${canvasIndex + 1}` });
                }
                for (let filterIndex = 0; filterIndex < (model.filteredElements || []).length; filterIndex++) {
                    const filtered = model.filteredElements[filterIndex];
                    const absolute = {
                        x: Math.max(0, model.left + filtered.x),
                        y: Math.max(0, model.top + filtered.y),
                        width: Math.max(1, filtered.w),
                        height: Math.max(1, filtered.h)
                    };
                    const data = await page.screenshot({ type: 'png', clip: absolute, captureBeyondViewport: true });
                    images.push({ ...scaleRect(filtered), kind: 'image', data, z: filtered.z, name: filtered.name });
                }
            const warnFont = createFontWarningCollector({
                slide: slideIndex + 1,
                onWarning: (warning) => {
                    model.warnings.push(warning);
                    puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint export font substitution (non-fatal)', { requestId, warning });
                }
            });
            const normalizeTextItem = (item) => {
                const normalized = { ...item, fontFace: warnFont(item.fontFace) };
                normalized.name = normalized.name || `Text: ${String(normalized.text || '').replace(/\s+/g, ' ').trim().slice(0, 48)}`;
                normalized.runs = (item.runs || []).map(run => ({ ...run, fontFamily: warnFont(run.fontFamily || item.fontFace) }));
                normalized.paragraphs = (item.paragraphs || []).map(paragraph => ({
                    ...paragraph,
                    runs: (paragraph.runs || []).map(run => ({ ...run, fontFamily: warnFont(run.fontFamily || item.fontFace) }))
                }));
                return normalized;
            };
            const editableShapes = model.shapes.filter(item => !item.rasterize).map((shape) => {
                const distinctBorder = shape.borderInfo && !shape.borderInfo.borderUniform && shape.borderInfo.borderVisible && !shape.borderInfo.hasRadius;
                return distinctBorder ? { ...shape, borderColor: 'transparent', borderWidth: 0, borderCompensate: false } : shape;
            });
            const scaledShapes = [...editableShapes, ...sideBorderShapes, ...decorativeShapes.filter(item => !item.rasterize)].map((shape) => ({
                ...scaleRect(shape),
                name: shape.name || `Shape: ${shape.selector || 'background'}`
            }));
            const scaledTexts = [...model.texts, ...(model.pseudoDecorations || []).filter(item => item.kind === 'text')]
                .filter(item => !item.rasterize)
                .map(item => scaleRect(normalizeTextItem(item)));
            const scaledTables = (model.tables || []).map(table => ({
                ...scaleRect(table),
                columns: (table.columns || []).map(width => pxToEmu(width * SLIDE_W_PX / model.width, 'x')),
                rows: (table.rows || []).map(row => ({
                    ...row,
                    height: pxToEmu(row.height * SLIDE_H_PX / model.height, 'y')
                }))
            }));
            const scaledImages = images.filter(image => !image.rasterize).map(image => ({
                ...image,
                name: image.name || `Image: ${image.alt || 'untitled'}`
            }));
            const gradientWarnings = new Set();
            scaledShapes.forEach((item) => {
                if (!item.gradient || /url\(/i.test(item.gradient)) return;
                if (!parseCssGradient(item.gradient, { width: item.w, height: item.h })) {
                    const key = String(item.gradient);
                    if (gradientWarnings.has(key)) return;
                    gradientWarnings.add(key);
                    // Background elements are rasterized above. This branch is intentionally
                    // limited to pseudo decorations and future shape sources that cannot be
                    // mapped back to a DOM node without risking duplicate rasterization.
                    puppeteerLog.warn(ErrorCategory.PUPPETEER, 'PowerPoint gradient fallback (non-fatal)', {
                        requestId,
                        warning: {
                            slide: slideIndex + 1,
                            selector: item.selector || item.name || 'shape',
                            tipo: 'gradient-fallback',
                            motivo: 'gradiente CSS no representable como fill nativo',
                            fallback: 'solid-color-for-unsupported-decoration'
                        }
                    });
                }
            });
            const items = [...scaledShapes, ...scaledImages, ...scaledTexts, ...scaledTables]
                .sort(compareZKeys);
            slides.push({
                background: { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT, fill: model.background || '#FFFFFF', borderWidth: 0 },
                backgroundImage,
                items,
                shapes: items.filter(item => item.kind === 'shape'),
                texts: items.filter(item => item.kind === 'text'),
                images: items.filter(item => item.kind === 'image'),
                tables: items.filter(item => item.kind === 'table')
            });
        }
        const pptxBuffer = await createEditablePptx(slides, title || 'Presentation');
        if (debug || process.env.EXPORT_DEBUG === '1') {
            const debugDir = path.join(TMP_DIR, 'export-debug', String(requestId).replace(/[^a-z0-9_-]/gi, '_'));
            fs.mkdirSync(debugDir, { recursive: true });
            fs.writeFileSync(path.join(debugDir, 'input.html'), html, 'utf8');
            fs.writeFileSync(path.join(debugDir, 'slideData.json'), JSON.stringify(slideData, null, 2), 'utf8');
            const allWarnings = [...slideData.flatMap(model => model.warnings || []).map(warning => normalizeExportWarning(warning, warning.slide)), ...assetWarnings.map(warning => normalizeExportWarning({ slide: 0, selector: warning.asset, tipo: 'image-load-failed', motivo: warning.reason, fallback: 'omit failed asset and continue' }))];
            fs.writeFileSync(path.join(debugDir, 'warnings.json'), JSON.stringify({ warnings: allWarnings, counts: countExportWarnings(allWarnings) }, null, 2), 'utf8');
            for (let index = 0; index < slideData.length; index++) {
                const model = slideData[index];
                await page.screenshot({ path: path.join(debugDir, `slide-${index + 1}-dom.png`), clip: { x: Math.max(0, model.left), y: Math.max(0, model.top), width: Math.max(1, model.width), height: Math.max(1, model.height) }, captureBeyondViewport: true });
                const rasterItems = (slides[index]?.images || []).filter(item => item.data);
                rasterItems.forEach((item, rasterIndex) => fs.writeFileSync(path.join(debugDir, `slide-${index + 1}-raster-${rasterIndex + 1}.png`), item.data));
            }
            let offset = 0;
            while (offset + 30 <= pptxBuffer.length) {
                if (pptxBuffer.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; }
                const method = pptxBuffer.readUInt16LE(offset + 8);
                const compressedSize = pptxBuffer.readUInt32LE(offset + 18);
                const nameLength = pptxBuffer.readUInt16LE(offset + 26);
                const extraLength = pptxBuffer.readUInt16LE(offset + 28);
                const name = pptxBuffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
                const start = offset + 30 + nameLength + extraLength;
                const data = pptxBuffer.subarray(start, start + compressedSize);
                if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) fs.writeFileSync(path.join(debugDir, path.basename(name)), method === 8 ? zlib.inflateRawSync(data) : data);
                offset = start + compressedSize;
            }
        }
        const allWarnings = [...slideData.flatMap(model => model.warnings || []).map(warning => normalizeExportWarning(warning, warning.slide)), ...assetWarnings.map(warning => normalizeExportWarning({ slide: 0, selector: warning.asset, tipo: 'image-load-failed', motivo: warning.reason, fallback: 'omit failed asset and continue' }))];
        pptxBuffer.exportWarningCounts = countExportWarnings(allWarnings);
        return pptxBuffer;
    } finally {
        await page.close();
    }
}

    return renderEditablePptx;
}

module.exports = { createPptxRenderer };
