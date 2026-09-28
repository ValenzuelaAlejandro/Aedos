const zlib = require('zlib');

const EMU_PER_INCH = 914400;
const PX_PER_INCH = 96;
const PT_PER_PX = 72 / PX_PER_INCH;
const SLIDE_WIDTH_IN = 13.333333;
const SLIDE_HEIGHT_IN = 7.5;
const SLIDE_W_PX = 1122;
const SLIDE_H_PX = 631;
const SLIDE_WIDTH = SLIDE_WIDTH_IN * EMU_PER_INCH;
const SLIDE_HEIGHT = SLIDE_HEIGHT_IN * EMU_PER_INCH;
const PX_TO_EMU_X = SLIDE_WIDTH / SLIDE_W_PX;
const PX_TO_EMU_Y = SLIDE_HEIGHT / SLIDE_H_PX;
const PX_TO_PT = SLIDE_WIDTH_IN * 72 / SLIDE_W_PX;
// Extra width protects against small font-metric differences between Chromium
// and PowerPoint without changing the measured text anchor or its height.
const TEXT_WIDTH_SAFETY = 1.03;
// Native DrawingML alpha is preserved for simple gradients. Unsupported
// gradient constructs still use the existing rasterized-region fallback.
const GRADIENT_ALPHA_MODE = 'native';
// Calibrated against PowerPoint 16.0.10417.20208 using the shadow fixture:
// blurRad = CSS blur in the slide's EMU scale. A 0.5× candidate was visibly
// too tight; 1.0× minimized the aggregate region MAE across simple shadows.
const CSS_BLUR_TO_SHADOW_RAD = 1;
// Office-safe fallbacks for web fonts that are not embedded in this package.
// The first safe family in a CSS stack wins; known web families map to the
// closest stable Windows/Office metric to reduce reflow in PowerPoint.
const FONT_FALLBACKS = [
    { category: 'serif', pattern: /playfair|cormorant|cinzel|lora|bitter|fraunces|liberation serif|(?:^|\s)serif$/i, family: 'Georgia' },
    { category: 'sans-serif', pattern: /^(sans-serif|ui-sans-serif)$/i, family: 'Arial' },
    { category: 'display', pattern: /bebas|archivo black|impact|display|black/i, family: 'Arial Narrow' },
    { category: 'monospace', pattern: /^(monospace|ui-monospace)$|mono|code|courier/i, family: 'Courier New' }
];
const OFFICE_FONTS = new Set(['arial', 'calibri', 'aptos', 'georgia', 'times new roman', 'verdana', 'tahoma', 'trebuchet ms', 'arial narrow', 'arial black', 'courier new']);
const CSS_COLOR_NAMES = {
    black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF',
    yellow: '#FFFF00', cyan: '#00FFFF', magenta: '#FF00FF', gray: '#808080', grey: '#808080',
    orange: '#FFA500', purple: '#800080', transparent: 'rgba(0,0,0,0)'
};

function escapeXml(value) {
    return String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function emu(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function pxToEmu(value, axis = 'x') {
    return emu((Number(value) || 0) * (axis === 'y' ? PX_TO_EMU_Y : PX_TO_EMU_X));
}

function pxToPt(value) {
    return (Number(value) || 0) * PX_TO_PT;
}

function resolveFontFamily(value) {
    const stack = String(value || '').split(',').map(part => part.replace(/["']/g, '').trim()).filter(Boolean);
    const installed = stack.find(part => OFFICE_FONTS.has(part.toLowerCase()));
    if (installed) return installed;
    for (const candidate of stack) {
        const mapped = FONT_FALLBACKS.find(entry => entry.pattern.test(candidate));
        if (mapped) return mapped.family;
    }
    return 'Arial';
}

function createFontWarningCollector({ slide, onWarning } = {}) {
    const warnedFamilies = new Set();
    return (original, selector = 'text') => {
        const raw = String(original || '').replace(/["']/g, '').trim();
        const primary = raw.split(',')[0].trim();
        const resolved = resolveFontFamily(raw);
        const familyKey = primary.toLowerCase();
        if (raw && !OFFICE_FONTS.has(familyKey) && !warnedFamilies.has(familyKey)) {
            warnedFamilies.add(familyKey);
            onWarning?.({ slide, selector, tipo: 'font-substitution', de: raw, a: resolved });
        }
        return resolved;
    };
}

function compareZKeys(left = {}, right = {}) {
    const a = Array.isArray(left.zKey) ? left.zKey : [0, Number(left.domIndex) || 0, 0];
    const b = Array.isArray(right.zKey) ? right.zKey : [0, Number(right.domIndex) || 0, 0];
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index++) {
        const av = Number(a[index] ?? 0);
        const bv = Number(b[index] ?? 0);
        if (av !== bv) return av - bv;
    }
    return (Number(left.domIndex) || 0) - (Number(right.domIndex) || 0);
}

function colorParts(value, fallback = 'FFFFFF') {
    const rawValue = String(value || '').trim();
    const raw = CSS_COLOR_NAMES[rawValue.toLowerCase()] || rawValue;
    const match = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i);
    if (match) {
        return {
            hex: [match[1], match[2], match[3]]
            .map(part => Number(part).toString(16).padStart(2, '0'))
            .join('').toUpperCase(),
            alpha: match[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(match[4])))
        };
    }
    const hex = raw.replace('#', '').trim();
    if (/^[0-9a-f]{6}$/i.test(hex)) return { hex: hex.toUpperCase(), alpha: 1 };
    if (/^[0-9a-f]{3}$/i.test(hex)) return { hex: hex.split('').map(part => part + part).join('').toUpperCase(), alpha: 1 };
    return { hex: fallback, alpha: 1 };
}

function splitTopLevel(value) {
    const parts = [];
    let current = '';
    let depth = 0;
    for (const character of String(value || '')) {
        if (character === '(') depth++;
        if (character === ')') depth--;
        if (character === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += character;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function parseCssShadows(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.toLowerCase() === 'none') return [];
    return splitTopLevel(raw).map((shadow) => {
        const colorMatch = shadow.match(/(?:rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b|(?:transparent|black|white|red|green|blue|yellow|cyan|magenta|gray|grey|orange|purple)\b)/i);
        const colorValue = colorMatch ? colorMatch[0] : '#000000';
        const numbers = shadow
            .replace(colorValue, ' ')
            .replace(/\binset\b/ig, ' ')
            .match(/-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt|em|rem)?/gi) || [];
        const px = numbers.map((token) => {
            const parsed = parseFloat(token);
            return Number.isFinite(parsed) ? parsed : 0;
        });
        if (px.length < 2) return null;
        const parsedColor = colorParts(colorValue, '000000');
        return {
            raw: shadow,
            color: colorValue,
            hex: parsedColor.hex,
            alpha: parsedColor.alpha,
            inset: /\binset\b/i.test(shadow),
            xPx: px[0],
            yPx: px[1],
            blurPx: Math.max(0, px[2] || 0),
            spreadPx: px[3] || 0
        };
    }).filter(Boolean);
}

function analyzeCssShadow(value) {
    const shadows = parseCssShadows(value);
    if (!shadows.length) return { shadows, dominant: null, ring: null, warnings: [] };
    const ring = shadows.find((shadow) => !shadow.inset && shadow.xPx === 0 && shadow.yPx === 0 && shadow.blurPx === 0 && shadow.spreadPx > 0) || null;
    const dominant = shadows.slice().sort((left, right) => {
        const leftScore = left.alpha * Math.max(left.blurPx, 1);
        const rightScore = right.alpha * Math.max(right.blurPx, 1);
        return rightScore - leftScore;
    })[0];
    const warnings = [];
    if (shadows.length > 1) warnings.push({ motivo: 'múltiples sombras CSS', fallback: 'aplicar la sombra dominante alpha×blur' });
    if (dominant?.inset) warnings.push({ motivo: 'sombra inset no tiene equivalente outerShdw', fallback: 'aplicar la sombra dominante como outerShdw' });
    if (dominant && dominant.spreadPx !== 0 && !ring) {
        warnings.push({ motivo: 'spread CSS no tiene equivalente directo en outerShdw', fallback: 'aproximar con outerShdw sin spread' });
    }
    return { shadows, dominant, ring, warnings };
}

function shadowEffectXml(value) {
    const analysis = typeof value === 'string' ? analyzeCssShadow(value) : value;
    const shadow = analysis?.dominant;
    if (!shadow || analysis.ring === shadow) return '';
    const dist = Math.round(Math.hypot(pxToEmu(shadow.xPx, 'x'), pxToEmu(shadow.yPx, 'y')));
    const direction = ((Math.atan2(shadow.yPx, shadow.xPx) * 180 / Math.PI) % 360 + 360) % 360;
    const dir = Math.round(direction * 60000);
    const blurRad = Math.round(pxToEmu(shadow.blurPx, 'x') * CSS_BLUR_TO_SHADOW_RAD);
    const alpha = Math.round(Math.max(0, Math.min(1, shadow.alpha)) * 100000);
    return `<a:effectLst><a:outerShdw blurRad="${blurRad}" dist="${dist}" dir="${dir}" algn="ctr" rotWithShape="0"><a:srgbClr val="${shadow.hex}"><a:alpha val="${alpha}"/></a:srgbClr></a:outerShdw></a:effectLst>`;
}

function parseCssAngle(value, width = 1, height = 1) {
    const raw = String(value || '').trim().toLowerCase();
    const direction = raw.match(/^to\s+(.+)$/);
    if (direction) {
        const tokens = direction[1].split(/\s+/);
        const vertical = tokens.find(token => ['top', 'bottom'].includes(token));
        const horizontal = tokens.find(token => ['left', 'right'].includes(token));
        if (vertical && horizontal) {
            const diagonal = Math.atan2(height, width) * 180 / Math.PI;
            if (vertical === 'bottom' && horizontal === 'right') return 90 + diagonal;
            if (vertical === 'bottom' && horizontal === 'left') return 270 - diagonal;
            if (vertical === 'top' && horizontal === 'right') return 90 - diagonal;
            if (vertical === 'top' && horizontal === 'left') return 270 + diagonal;
        }
        return ({ top: 0, right: 90, bottom: 180, left: 270 })[vertical || horizontal] ?? 180;
    }
    const match = raw.match(/^(-?[\d.]+)(deg|grad|rad|turn)$/);
    if (!match) return null;
    const amount = Number(match[1]);
    const factor = ({ deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 })[match[2]];
    return ((amount * factor) % 360 + 360) % 360;
}

function splitStopToken(value) {
    const match = String(value || '').trim().match(/^(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)(?:\s+(.+))?$/i);
    if (!match) return null;
    return { color: match[1], position: match[2] || null };
}

function parseStopPosition(value, size) {
    if (!value) return null;
    const match = String(value).trim().match(/^(-?[\d.]+)(%|px)?$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    return match[2] === '%' ? amount / 100 : amount / Math.max(1, size);
}

function normalizeGradientStops(stopTokens, size) {
    const parsed = stopTokens.map(splitStopToken).filter(Boolean).map(stop => ({
        ...stop,
        transparentKeyword: stop.color.toLowerCase() === 'transparent',
        position: parseStopPosition(stop.position, size)
    }));
    if (parsed.length < 2) return null;
    const step = 1 / (parsed.length - 1);
    if (parsed[0].position === null) parsed[0].position = 0;
    if (parsed.at(-1).position === null) parsed.at(-1).position = 1;
    let index = 0;
    while (index < parsed.length) {
        if (parsed[index].position !== null) {
            index++;
            continue;
        }
        const start = index - 1;
        let end = index;
        while (end < parsed.length && parsed[end].position === null) end++;
        const from = parsed[start]?.position ?? 0;
        const to = parsed[end]?.position ?? Math.min(1, from + step * (end - start));
        for (let offset = 0; offset < end - index; offset++) parsed[index + offset].position = from + (to - from) * (offset + 1) / (end - start);
        index = end;
    }
    for (index = 1; index < parsed.length; index++) {
        if (parsed[index].position < parsed[index - 1].position) parsed[index].position = parsed[index - 1].position;
    }
    const parsedColors = parsed.map(stop => colorParts(stop.color));
    const nearestSolid = (index) => {
        for (let distance = 1; distance < parsed.length; distance++) {
            for (const candidate of [index - distance, index + distance]) {
                if (candidate >= 0 && candidate < parsed.length && parsedColors[candidate].alpha > 0) return parsed[candidate].color;
            }
        }
        return '#000000';
    };
    return parsed.map((stop, index) => {
        const sourceParts = parsedColors[index];
        const alphaZero = sourceParts.alpha === 0;
        const parts = colorParts(alphaZero ? nearestSolid(index) : stop.color);
        return {
            ...parts,
            alpha: alphaZero ? 0 : parts.alpha,
            position: Math.max(0, Math.min(1, stop.position)),
            source: stop.color
        };
    });
}

function parseCssGradient(value, { width = 1, height = 1 } = {}) {
    const css = String(value || '').trim();
    const match = css.match(/^(linear-gradient|radial-gradient)\((.*)\)$/i);
    if (!match || /repeating-|conic-gradient/i.test(css) || splitTopLevel(css).length > 1) return null;
    const parts = splitTopLevel(match[2]);
    const type = match[1].toLowerCase().startsWith('radial') ? 'radial' : 'linear';
    let angle = 180;
    let stopStart = 0;
    if (type === 'linear' && parts[0] && (parseCssAngle(parts[0], width, height) !== null)) {
        angle = parseCssAngle(parts[0], width, height);
        stopStart = 1;
    }
    if (type === 'radial' && parts[0] && !splitStopToken(parts[0])) stopStart = 1;
    const stops = normalizeGradientStops(parts.slice(stopStart), Math.max(width, height));
    if (!stops) return null;
    return {
        type,
        angle: ((angle % 360) + 360) % 360,
        stops,
        radialShape: type === 'radial' ? (parts[0] || 'ellipse').toLowerCase() : null
    };
}

function color(value, fallback = 'FFFFFF') {
    return colorParts(value, fallback).hex;
}

function colorXml(value, fallback = 'FFFFFF') {
    const parsed = colorParts(value, fallback);
    const alpha = parsed.alpha < 0.999 ? `<a:alpha val="${Math.round(parsed.alpha * 100000)}"/>` : '';
    return `<a:srgbClr val="${parsed.hex}">${alpha}</a:srgbClr>`;
}

function isTransparent(value) {
    const normalized = String(value || '').replace(/\s/g, '').toLowerCase();
    return !normalized || normalized === 'transparent' || normalized === 'rgba(0,0,0,0)';
}

function xfrm(x, y, w, h) {
    return `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
}

function geometry(shape = {}) {
    return `<a:prstGeom prst="${Number(shape.borderRadius) > 0 ? 'roundRect' : 'rect'}"><a:avLst/></a:prstGeom>`;
}

function gradientXml(gradient, shape = {}) {
    const parsed = typeof gradient === 'string'
        ? parseCssGradient(gradient, { width: Number(shape.w) || 1, height: Number(shape.h) || 1 })
        : gradient;
    if (!parsed) return null;
    const stops = parsed.stops.map(stop => `<a:gs pos="${Math.round(stop.position * 100000)}"><a:srgbClr val="${stop.hex}">${stop.alpha < 0.999 ? `<a:alpha val="${Math.round(stop.alpha * 100000)}"/>` : ''}</a:srgbClr></a:gs>`).join('');
    if (parsed.type === 'radial') return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:path path="circle"><a:fillToRect l="0" t="0" r="0" b="0"/></a:path></a:gradFill>`;
    const angle = Math.round((((parsed.angle - 90 + 360) % 360) * 60000));
    return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${angle}" scaled="0"/></a:gradFill>`;
}

function fillXml(fill, shape = {}) {
    const gradient = shape.gradient || shape.backgroundImage;
    const gradientMarkup = gradientXml(gradient, shape);
    if (gradientMarkup) return gradientMarkup;
    return isTransparent(fill) ? '<a:noFill/>' : `<a:solidFill>${colorXml(fill)}</a:solidFill>`;
}

function lineXml(lineColor, lineWidth = 0) {
    if (isTransparent(lineColor) || !lineWidth) return '<a:ln><a:noFill/></a:ln>';
    return `<a:ln w="${emu(Math.max(1, lineWidth) * 12700)}"><a:solidFill>${colorXml(lineColor)}</a:solidFill></a:ln>`;
}

function paragraphAlignment(value) {
    return ({ left: 'l', center: 'ctr', right: 'r', justify: 'just' })[value] || 'l';
}

function runPropertiesXml(run = {}, shape = {}, addHyperlink) {
    const fontSize = Math.max(600, Math.round(pxToPt(Number(run.sizePx ?? shape.fontSize) || 12) * 100));
    const fontFace = escapeXml(run.fontFamily || shape.fontFace || 'Aptos');
    const attrs = [
        'lang="en-US"',
        `sz="${fontSize}"`,
        run.weight >= 600 || run.bold ? 'b="1"' : '',
        run.italic ? 'i="1"' : '',
        run.underline ? 'u="sng"' : '',
        run.strike ? 'strike="sngStrike"' : '',
        Number.isFinite(Number(run.baseline)) && Number(run.baseline) !== 0 ? `baseline="${Math.round(Number(run.baseline))}"` : '',
        Number.isFinite(Number(run.letterSpacingPx)) && Number(run.letterSpacingPx) !== 0
            ? `spc="${Math.round(pxToPt(Number(run.letterSpacingPx)) * 100)}"`
            : ''
    ].filter(Boolean).join(' ');
    const hyperlinkId = run.href && addHyperlink ? addHyperlink(run.href) : null;
    const hyperlink = hyperlinkId ? `<a:hlinkClick r:id="${hyperlinkId}"/>` : '';
    const fill = `<a:solidFill>${colorXml(run.color || shape.textColor, '111111')}</a:solidFill>`;
    const textShadow = shadowEffectXml(run.textShadow || shape.textShadow);
    return `<a:rPr ${attrs}>${fill}${textShadow}<a:latin typeface="${fontFace}"/><a:ea typeface="${fontFace}"/><a:cs typeface="${fontFace}"/>${hyperlink}</a:rPr>`;
}

function paragraphXml(paragraph, shape, addHyperlink) {
    const runs = Array.isArray(paragraph.runs) && paragraph.runs.length
        ? paragraph.runs
        : [{ text: paragraph.text || '', sizePx: shape.fontSize, fontFamily: shape.fontFace, weight: shape.bold ? 700 : 400, italic: Boolean(shape.italic), color: shape.textColor }];
    const lineSpacing = paragraph.lineHeightNormal
        ? '<a:lnSpc><a:spcPct val="100000"/></a:lnSpc>'
        : paragraph.lineHeightPx
        ? `<a:lnSpc><a:spcPts val="${Math.max(1, Math.round(pxToPt(paragraph.lineHeightPx) * 100))}"/></a:lnSpc>`
        : '<a:lnSpc><a:spcPct val="100000"/></a:lnSpc>';
    const bullet = paragraph.bullet || shape.bullet;
    const bulletXml = bullet && bullet.type === 'number'
        ? `<a:buAutoNum type="${escapeXml(bullet.style || 'arabicPeriod')}"${Number.isFinite(Number(bullet.startAt)) ? ` startAt="${Math.max(1, Math.round(Number(bullet.startAt)))}"` : ''}/>`
        : bullet
            ? `<a:buChar char="${escapeXml(bullet.char || '•')}"/>`
            : '<a:buNone/>';
    const bulletAttrs = bullet && bullet.level > 0 ? ` lvl="${Math.max(0, Math.round(bullet.level))}"` : '';
    const marginLeftEmu = bullet && (bullet.marginLeftEmu || bullet.marginLeftPx)
        ? (bullet.marginLeftEmu || pxToEmu(bullet.marginLeftPx, 'x'))
        : 0;
    const marginAttrs = marginLeftEmu
        ? ` marL="${Math.round(marginLeftEmu)}" indent="${Math.round(bullet.indentEmu || -marginLeftEmu / 2)}"`
        : '';
    const spaceBeforePt = paragraph.spaceBeforePt ?? (paragraph.spaceBeforePx ? pxToPt(paragraph.spaceBeforePx) : 0);
    const spaceAfterPt = paragraph.spaceAfterPt ?? (paragraph.spaceAfterPx ? pxToPt(paragraph.spaceAfterPx) : 0);
    const spacing = `${lineSpacing}${spaceBeforePt ? `<a:spcBef><a:spcPts val="${Math.round(spaceBeforePt * 100)}"/></a:spcBef>` : ''}${spaceAfterPt ? `<a:spcAft><a:spcPts val="${Math.round(spaceAfterPt * 100)}"/></a:spcAft>` : ''}`;
    const content = runs.map((run) => {
        if (run.break) return `<a:br>${runPropertiesXml(run, shape, addHyperlink)}</a:br>`;
        return `<a:r>${runPropertiesXml(run, shape, addHyperlink)}<a:t>${escapeXml(run.text || ' ')}</a:t></a:r>`;
    }).join('');
    const lastRun = runs.filter(run => !run.break).at(-1) || {};
    const endSize = Math.max(600, Math.round(pxToPt(Number(lastRun.sizePx ?? shape.fontSize) || 12) * 100));
    return `<a:p><a:pPr algn="${paragraphAlignment(paragraph.align || shape.align)}"${bulletAttrs}${marginAttrs}>${spacing}${bulletXml}</a:pPr>${content}<a:endParaRPr lang="en-US" sz="${endSize}"/></a:p>`;
}

function shapeXml(id, shape, { textBox = false, addHyperlink } = {}) {
    const fill = textBox ? '<a:noFill/>' : fillXml(shape.fill, shape);
    const shadow = textBox ? { warnings: [] } : analyzeCssShadow(shape.shadow);
    const ringColor = shadow.ring?.color || shape.borderColor;
    const ringWidth = shadow.ring ? Math.max(Number(shape.borderWidth) || 0, shadow.ring.spreadPx) : shape.borderWidth;
    const line = textBox ? '<a:ln><a:noFill/></a:ln>' : lineXml(ringColor, ringWidth);
    const effects = textBox ? '' : shadowEffectXml(shadow);
    const name = escapeXml(shape.name || `${textBox ? 'Text' : 'Shape'} ${id}`);

    let txBody = '';
    if (textBox) {
        const fontSize = Math.max(600, Math.round(pxToPt(Number(shape.fontSize) || 12) * 100));
        const fontFace = escapeXml(shape.fontFace || 'Aptos');
        const textColor = color(shape.textColor, '111111');
        const paragraphProps = (shape.bullet ? ' marL="228600" indent="-228600"' : '') +
            '><a:lnSpc><a:spcPct val="115000"/></a:lnSpc>' +
            (shape.paragraphGap ? '<a:spcAft><a:spcPts val="500"/></a:spcAft>' : '');
        const legacyParagraphs = String(shape.text || '').split(/\r?\n/).map(lineText => `
            <a:p>
                <a:pPr algn="${paragraphAlignment(shape.align)}"${paragraphProps}${shape.bullet ? '<a:buChar char="•"/>' : ''}</a:pPr>
                <a:r>
                    <a:rPr lang="en-US" sz="${fontSize}"${shape.bold ? ' b="1"' : ''}${shape.italic ? ' i="1"' : ''}>
                        <a:solidFill><a:srgbClr val="${textColor}"/></a:solidFill>
                        <a:latin typeface="${fontFace}"/>
                    </a:rPr>
                    <a:t>${escapeXml(lineText || ' ')}</a:t>
                </a:r>
                <a:endParaRPr lang="en-US" sz="${fontSize}"/>
            </a:p>`).join('');
        const paragraphsModel = Array.isArray(shape.paragraphs) && shape.paragraphs.length
            ? shape.paragraphs
            : String(shape.text || '').split(/\r?\n/).map(text => ({ text, align: shape.align }));
        const paragraphs = paragraphsModel.map(paragraph => paragraphXml(paragraph, shape, addHyperlink)).join('');
        txBody = `<p:txBody>
            <a:bodyPr wrap="${shape.noWrap ? 'none' : 'square'}" lIns="0" rIns="0" tIns="0" bIns="0" anchor="${shape.valign === 'middle' ? 'ctr' : 't'}"><a:noAutofit/></a:bodyPr>
            <a:lstStyle/>${paragraphs}
        </p:txBody>`;
    }

    return `<p:${textBox ? 'sp' : 'sp'}>
        <p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr${textBox ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>
        <p:spPr>${xfrm(shape.x, shape.y, shape.w, shape.h)}${geometry(shape)}${fill}${line}${effects}</p:spPr>
        ${txBody}
    </p:sp>`;
}

function imageXml(id, image, relationshipId) {
    const name = escapeXml(image.name || `Image ${id}`);
    return `<p:pic>
        <p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr>${xfrm(image.x, image.y, image.w, image.h)}${geometry(image)}<a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
    </p:pic>`;
}

function groupStart() {
    return `<p:spTree>
        <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(SLIDE_WIDTH)}" cy="${emu(SLIDE_HEIGHT)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(SLIDE_WIDTH)}" cy="${emu(SLIDE_HEIGHT)}"/></a:xfrm></p:grpSpPr>`;
}

function slideXml(model, slideNumber) {
    let id = 2;
    const relationships = [];
    const content = [];
    const mediaRelationships = [];
    const relationshipByTarget = new Map();
    const addRelationship = (relationship) => {
        const relId = `rId${relationships.length + 1}`;
        relationships.push({ id: relId, ...relationship });
        return relId;
    };
    const addHyperlink = (target) => {
        const normalized = String(target || '').trim();
        if (!/^https?:\/\//i.test(normalized)) return null;
        if (relationshipByTarget.has(normalized)) return relationshipByTarget.get(normalized);
        const relId = addRelationship({ type: 'hyperlink', target: normalized, external: true });
        relationshipByTarget.set(normalized, relId);
        return relId;
    };

    if (model.background) content.push(shapeXml(id++, model.background));
    if (model.backgroundImage) {
        const mediaName = `slide${slideNumber}-image${mediaRelationships.length + 1}.png`;
        const relId = addRelationship({ type: 'image', target: `../media/${mediaName}`, image: model.backgroundImage, mediaName });
        mediaRelationships.push(relId);
        content.push(imageXml(id++, model.backgroundImage, relId));
    }
    const orderedItems = (Array.isArray(model.items)
        ? model.items
        : [
            ...(model.shapes || []).map(shape => ({ ...shape, kind: 'shape' })),
            ...(model.images || []).map(image => ({ ...image, kind: 'image' })),
            ...(model.texts || []).map(text => ({ ...text, kind: 'text' }))
        ]).slice().sort(compareZKeys);
    for (const item of orderedItems) {
        if (item.kind === 'image' || item.image || item.data) {
            const mediaName = `slide${slideNumber}-image${mediaRelationships.length + 1}.png`;
            const relId = addRelationship({ type: 'image', target: `../media/${mediaName}`, image: item, mediaName });
            mediaRelationships.push(relId);
            content.push(imageXml(id++, item, relId));
        } else if (item.kind === 'text' || item.text !== undefined || item.paragraphs) {
            content.push(shapeXml(id++, item, { textBox: true, addHyperlink }));
        } else {
            content.push(shapeXml(id++, item));
        }
    }

    const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:cSld name="Slide ${slideNumber}">${groupStart()}${content.join('')}</p:spTree></p:cSld>
    <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    ${relationships.map(rel => `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${rel.type}" Target="${escapeXml(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/>`).join('')}
    <Relationship Id="rId${relationships.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    <Relationship Id="rId${relationships.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideNumber}.xml"/>
</Relationships>`;
    return { slide, rels, relationships };
}

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u16(value) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value, 0); return buffer; }
function u32(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0, 0); return buffer; }

function zip(entries) {
    const local = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const source = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
        const compressed = zlib.deflateRawSync(source, { level: 6 });
        const checksum = crc32(source);
        const header = Buffer.concat([
            Buffer.from('PK\x03\x04', 'binary'), u16(20), u16(0), u16(8), u16(0), u16(0), u32(checksum),
            u32(compressed.length), u32(source.length), u16(name.length), u16(0), name
        ]);
        local.push(header, compressed);
        const centralHeader = Buffer.concat([
            Buffer.from('PK\x01\x02', 'binary'), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(checksum),
            u32(compressed.length), u32(source.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name
        ]);
        central.push(centralHeader);
        offset += header.length + compressed.length;
    }
    const centralBuffer = Buffer.concat(central);
    const end = Buffer.concat([
        Buffer.from('PK\x05\x06', 'binary'), u16(0), u16(0), u16(entries.length), u16(entries.length),
        u32(centralBuffer.length), u32(offset), u16(0)
    ]);
    return Buffer.concat([...local, centralBuffer, end]);
}

function relationshipsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;
}

function themeXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Aedos">
    <a:themeElements>
        <a:clrScheme name="Aedos"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F9FAFB"/></a:lt2><a:accent1><a:srgbClr val="6C63FF"/></a:accent1><a:accent2><a:srgbClr val="00B3B8"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="EF4444"/></a:accent4><a:accent5><a:srgbClr val="10B981"/></a:accent5><a:accent6><a:srgbClr val="3B82F6"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
        <a:fontScheme name="Aedos"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Aptos Display"/><a:cs typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Aptos"/><a:cs typeface="Aptos"/></a:minorFont></a:fontScheme>
        <a:fmtScheme name="Aedos">
            <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="70000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst>
            <a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>
            <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
            <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="70000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst>
        </a:fmtScheme>
    </a:themeElements>
</a:theme>`;
}

function slideLayoutXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1" matchingName="Blank"><p:cSld name="Blank">${groupStart()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function slideMasterXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Master">${groupStart()}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:buNone/><a:defRPr sz="4400"><a:latin typeface="Aptos Display"/><a:ea typeface="Aptos Display"/><a:cs typeface="Aptos Display"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr algn="l"><a:buNone/><a:defRPr sz="2800"><a:latin typeface="Aptos"/><a:ea typeface="Aptos"/><a:cs typeface="Aptos"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr/></p:otherStyle></p:txStyles></p:sldMaster>`;
}

function notesMasterXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm/></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Header Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="hdr" sz="quarter"/></p:nvPr></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Date Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="dt" sz="quarter" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Image Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="5" name="Notes Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="6" name="Footer Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="ftr" sz="quarter" idx="4"/></p:nvPr></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="7" name="Slide Number Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" sz="quarter" idx="5"/></p:nvPr></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
}

function notesSlideXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm/></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="0"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

function presPropsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:extLst><p:ext xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" uri="{E76CE94A-603C-4142-B9EB-6D1370010A27}"><p14:discardImageEditData val="0"/></p:ext><p:ext xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" uri="{D31A062A-798A-4329-ABDD-BBA856620510}"><p14:defaultImageDpi val="32767"/></p:ext></p:extLst></p:presentationPr>`;
}

function tableStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
}

function presentationXml(slideCount) {
    const ids = Array.from({ length: slideCount }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 6}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="${emu(SLIDE_WIDTH)}" cy="${emu(SLIDE_HEIGHT)}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr/></p:defaultTextStyle></p:presentation>`;
}

function presentationRels(slideCount) {
    const slides = Array.from({ length: slideCount }, (_, i) => `<Relationship Id="rId${i + 6}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>${slides}</Relationships>`;
}

function contentTypes(slideCount) {
    const slides = Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
    const notesSlides = Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideMasters/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/notesMasters/theme/theme3.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slides}${notesSlides}</Types>`;
}

function coreProperties(title) {
    const safeTitle = escapeXml(title || 'Presentation');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${safeTitle}</dc:title><dc:creator>Aedos</dc:creator><cp:lastModifiedBy>Aedos</cp:lastModifiedBy></cp:coreProperties>`;
}

function appProperties(slideCount) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Aedos</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${slideCount}</Slides></Properties>`;
}

async function createEditablePptx(slides, title) {
    const entries = [
        { name: '[Content_Types].xml', data: contentTypes(slides.length) },
        { name: '_rels/.rels', data: relationshipsXml() },
        { name: 'docProps/core.xml', data: coreProperties(title) },
        { name: 'docProps/app.xml', data: appProperties(slides.length) },
        { name: 'ppt/presentation.xml', data: presentationXml(slides.length) },
        { name: 'ppt/_rels/presentation.xml.rels', data: presentationRels(slides.length) },
        { name: 'ppt/theme/theme1.xml', data: themeXml() },
        { name: 'ppt/presProps.xml', data: presPropsXml() },
        { name: 'ppt/tableStyles.xml', data: tableStylesXml() },
        { name: 'ppt/slideMasters/slideMaster1.xml', data: slideMasterXml() },
        { name: 'ppt/slideMasters/theme/theme2.xml', data: themeXml() },
        { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme2.xml"/></Relationships>' },
        { name: 'ppt/slideLayouts/slideLayout1.xml', data: slideLayoutXml() },
        { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>' },
        { name: 'ppt/notesMasters/notesMaster1.xml', data: notesMasterXml() },
        { name: 'ppt/notesMasters/theme/theme3.xml', data: themeXml() },
        { name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme3.xml"/></Relationships>' }
    ];

    for (let index = 0; index < slides.length; index++) {
        const slideNumber = index + 1;
        const generated = slideXml(slides[index], slideNumber);
        entries.push({ name: `ppt/slides/slide${slideNumber}.xml`, data: generated.slide });
        entries.push({ name: `ppt/slides/_rels/slide${slideNumber}.xml.rels`, data: generated.rels });
        entries.push({ name: `ppt/notesSlides/notesSlide${slideNumber}.xml`, data: notesSlideXml() });
        entries.push({ name: `ppt/notesSlides/_rels/notesSlide${slideNumber}.xml.rels`, data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNumber}.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/></Relationships>` });
        generated.relationships.filter((relationship) => relationship.image).forEach((relationship) => {
            entries.push({ name: `ppt/media/${relationship.mediaName}`, data: relationship.image.data });
        });
    }

    return zip(entries);
}

module.exports = {
    createEditablePptx,
    EMU_PER_INCH,
    PX_PER_INCH,
    PT_PER_PX,
    PX_TO_EMU_X,
    PX_TO_EMU_Y,
    SLIDE_W_PX,
    SLIDE_H_PX,
    SLIDE_WIDTH_IN,
    SLIDE_HEIGHT_IN,
    SLIDE_WIDTH,
    SLIDE_HEIGHT,
    TEXT_WIDTH_SAFETY,
    FONT_FALLBACKS,
    OFFICE_FONTS,
    GRADIENT_ALPHA_MODE,
    CSS_BLUR_TO_SHADOW_RAD,
    resolveFontFamily,
    createFontWarningCollector,
    compareZKeys,
    parseCssGradient,
    parseCssShadows,
    analyzeCssShadow,
    shadowEffectXml,
    pxToEmu,
    pxToPt,
    color,
    isTransparent
};
