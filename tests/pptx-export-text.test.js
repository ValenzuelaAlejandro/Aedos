const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
    createEditablePptx,
    pxToPt,
    resolveFontFamily,
    createFontWarningCollector
} = require('../src/backend/utils/pptx-export');

function readZipEntries(buffer) {
    const entries = new Map();
    let offset = 0;
    while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
        const method = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
        const start = offset + 30 + nameLength + extraLength;
        const compressed = buffer.subarray(start, start + compressedSize);
        entries.set(name, (method === 8 ? zlib.inflateRawSync(compressed) : compressed).toString('utf8'));
        offset = start + compressedSize;
    }
    return entries;
}

test('text export preserves runs, breaks, hyperlinks and bullets', async () => {
    const pptx = await createEditablePptx([{
        background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#101114' },
        shapes: [],
        images: [],
        texts: [{
            x: 100000, y: 100000, w: 5000000, h: 1000000,
            fontSize: 18, fontFace: 'Arial',
            paragraphs: [{
                lineHeightPx: 24,
                runs: [
                    { text: 'plain & escaped', sizePx: 18, color: '#FFFFFF' },
                    { text: ' bold', sizePx: 18, weight: 700, color: '#E8B923' },
                    { text: ' italic', sizePx: 18, italic: true },
                    { text: ' link', sizePx: 18, href: 'https://example.com' },
                    { break: true, sizePx: 18 },
                    { text: '<next>', sizePx: 18, underline: true }
                ]
            }, {
                bullet: { type: 'char', char: '•', level: 1, marginLeftPx: 40 },
                runs: [{ text: 'nested', sizePx: 18 }]
            }, {
                bullet: { type: 'number', style: 'arabicPeriod', startAt: 3 },
                runs: [{ text: 'numbered', sizePx: 18 }]
            }]
        }]
    }], 'text test');
    const entries = readZipEntries(pptx);
    const slide = entries.get('ppt/slides/slide1.xml');
    const rels = entries.get('ppt/slides/_rels/slide1.xml.rels');

    assert.equal((slide.match(/<a:r>/g) || []).length, 7);
    assert.equal((slide.match(/<a:br>/g) || []).length, 1);
    assert.match(slide, /<a:noAutofit\/>/);
    assert.doesNotMatch(slide, /normAutofit/);
    assert.match(slide, /b="1"/);
    assert.match(slide, /i="1"/);
    assert.match(slide, /u="sng"/);
    assert.match(slide, /<a:buChar/);
    assert.match(slide, /<a:buAutoNum type="arabicPeriod" startAt="3"\/>/);
    assert.match(slide, /&amp;/);
    assert.match(slide, /&lt;next&gt;/);
    assert.match(slide, /<a:hlinkClick r:id="rId1"\/>/);
    assert.match(rels, /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/hyperlink"/);
    assert.match(rels, /TargetMode="External"/);
});

test('font conversion uses the shared physical px-to-pt module', () => {
    assert.equal(resolveFontFamily('Bebas Neue, sans-serif'), 'Arial Narrow');
    assert.equal(resolveFontFamily('Arial, sans-serif'), 'Arial');
    assert.ok(pxToPt(12) > 9);
});

test('XML escapes text, removes XML 1.0 control characters and keeps one-line text unwrapped', async () => {
    const pptx = await createEditablePptx([{
        background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#FFFFFF' },
        shapes: [],
        images: [],
        texts: [{
            x: 100000, y: 100000, w: 2000000, h: 300000, noWrap: true,
            fontSize: 18, fontFace: 'Arial',
            paragraphs: [{ runs: [{ text: 'bad\u0001 & <ok>' }] }]
        }]
    }], 'escape test');
    const slide = readZipEntries(pptx).get('ppt/slides/slide1.xml');
    assert.match(slide, /wrap="none"/);
    assert.match(slide, /bad &amp; &lt;ok&gt;/);
    assert.doesNotMatch(slide, /\u0001/);
});

test('line-height emits points for explicit values and percentage for normal or unspecified values', async () => {
    const pptx = await createEditablePptx([{
        background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#FFFFFF' },
        shapes: [],
        images: [],
        texts: [{
            x: 100000, y: 100000, w: 4000000, h: 1000000, fontSize: 18, fontFace: 'Arial',
            paragraphs: [
                { lineHeightPx: 24, runs: [{ text: 'explicit' }] },
                { lineHeightNormal: true, lineHeightPx: 21.6, runs: [{ text: 'normal' }] },
                { runs: [{ text: 'unspecified' }] }
            ]
        }]
    }], 'line height test');
    const slide = readZipEntries(pptx).get('ppt/slides/slide1.xml');
    assert.match(slide, new RegExp(`<a:spcPts val="${Math.round(pxToPt(24) * 100)}"\\/>`));
    assert.equal((slide.match(/<a:spcPct val="100000"\/>/g) || []).length, 2);
});

test('font substitution warnings are unique by source family and slide', () => {
    const warnings = [];
    const warnFont = createFontWarningCollector({ slide: 2, onWarning: warning => warnings.push(warning) });
    assert.equal(warnFont('DM Sans, sans-serif', 'p'), 'Arial');
    assert.equal(warnFont('DM Sans, sans-serif', 'span'), 'Arial');
    assert.equal(warnFont('Bebas Neue', 'h1'), 'Arial Narrow');
    assert.equal(warnFont('Arial, sans-serif', 'small'), 'Arial');
    assert.deepEqual(warnings, [
        { slide: 2, selector: 'p', tipo: 'font-substitution', de: 'DM Sans, sans-serif', a: 'Arial' },
        { slide: 2, selector: 'h1', tipo: 'font-substitution', de: 'Bebas Neue', a: 'Arial Narrow' }
    ]);
});

test('mixed span styles create distinct runs and resolve a hyperlink relationship', async () => {
    const pptx = await createEditablePptx([{
        background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#FFFFFF' },
        shapes: [],
        images: [],
        texts: [{
            x: 100000, y: 100000, w: 6000000, h: 500000, fontSize: 18, fontFace: 'Arial',
            paragraphs: [{ runs: [
                { text: 'plain', color: '#111111' },
                { text: ' color', color: '#D4A800' },
                { text: ' strong', weight: 700 },
                { text: ' em', italic: true },
                { text: ' link', href: 'https://example.com', underline: true }
            ] }]
        }]
    }], 'mixed span test');
    const entries = readZipEntries(pptx);
    const slide = entries.get('ppt/slides/slide1.xml');
    const rels = entries.get('ppt/slides/_rels/slide1.xml.rels');
    assert.equal((slide.match(/<a:r>/g) || []).length, 5);
    assert.ok((slide.match(/<a:rPr/g) || []).length >= 5);
    assert.match(slide, /b="1"/);
    assert.match(slide, /i="1"/);
    assert.match(slide, /u="sng"/);
    assert.match(slide, /<a:hlinkClick r:id="rId1"\/>/);
    assert.match(rels, /Target="https:\/\/example\.com" TargetMode="External"/);
});
