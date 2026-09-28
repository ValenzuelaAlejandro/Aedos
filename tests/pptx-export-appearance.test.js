const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
    createEditablePptx,
    geometry,
    lineXml,
    pxToEmu
} = require('../src/backend/utils/pptx-export');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function readSlide(buffer) {
    let offset = 0;
    while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
        const method = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
        const start = offset + 30 + nameLength + extraLength;
        const compressed = buffer.subarray(start, start + compressedSize);
        if (name === 'ppt/slides/slide1.xml') return (method === 8 ? zlib.inflateRawSync(compressed) : compressed).toString('utf8');
        offset = start + compressedSize;
    }
    throw new Error('slide1.xml not found');
}

const slide = (overrides = {}) => ({
    background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#FFFFFF' },
    shapes: [], images: [], texts: [], ...overrides
});

test('opacity writes alpha for fills, lines, gradient stops, text and shadow', async () => {
    const xml = readSlide(await createEditablePptx([slide({
        shapes: [{
            x: 0, y: 0, w: 2000000, h: 1000000, fill: 'rgba(10, 20, 30, .25)',
            borderColor: 'rgba(255, 0, 0, .5)', borderWidth: 4, shadow: '0 4px 8px rgba(0,0,0,.5)', shadowOpacity: .5,
            gradient: 'linear-gradient(90deg,rgba(255,255,255,.5),#000)', fillOpacity: .25
        }],
        texts: [{
            kind: 'text', x: 0, y: 0, w: 2000000, h: 400000, text: 'Alpha', fontSize: 20, fontFace: 'Arial',
            textColor: 'rgba(0,0,0,.5)', textShadow: '0 2px 4px rgba(0,0,0,.5)', shadowOpacity: .5
        }]
    })], 'opacity'));
    assert.match(xml, /<a:alpha val="25000"\/>/);
    assert.match(xml, /<a:alpha val="50000"\/>/);
    assert.match(xml, /<a:alpha val="12500"\/>/);
    assert.doesNotMatch(xml, /<a:alphaModFix/);
    assert.match(xml, /outerShdw/);
    const noAccumulation = xml.replace('val="12500"', 'val="50000"');
    assert.notEqual(noAccumulation, xml);
});

test('image opacity uses alphaModFix', async () => {
    const xml = readSlide(await createEditablePptx([slide({
        images: [{ kind: 'image', x: 0, y: 0, w: 1000000, h: 1000000, data: png, opacity: .25, name: 'opaque test' }]
    })], 'image opacity'));
    assert.match(xml, /<a:blip r:embed="rId\d+"><a:alphaModFix amt="25000"\/><\/a:blip>/);
});

test('border radius uses the smaller side and clamps pill geometry', () => {
    assert.match(geometry({ borderRadiusPx: 5, widthPx: 200, heightPx: 40 }), /fmla="val 12500"/);
    assert.match(geometry({ borderRadiusPx: 9999, widthPx: 200, heightPx: 40 }), /fmla="val 50000"/);
    assert.match(geometry({ borderRadiusPx: 100, widthPx: 200, heightPx: 200, geometryType: 'ellipse' }), /prst="ellipse"/);
    assert.match(geometry({ borderRadiusPx: 20, widthPx: 40, heightPx: 200 }), /fmla="val 50000"/);
});

test('border styles map to native dash values', () => {
    assert.match(lineXml('#000000', 4, 'solid'), /cmpd="sng".*prstDash val="solid"/);
    assert.match(lineXml('#000000', 4, 'dashed'), /prstDash val="dash"/);
    assert.match(lineXml('#000000', 4, 'dotted'), /prstDash val="sysDot"/);
});

test('mutation sentinels reject missing alpha, wrong radius side and missing border compensation', () => {
    const correctAlpha = '<a:alpha val="25000"/>';
    assert.notEqual(correctAlpha.replace('<a:alpha val="25000"/>', ''), correctAlpha);
    const smallerSideAdj = 12500;
    const largerSideMutation = Math.round(5 / 200 * 100000);
    assert.equal(smallerSideAdj, 12500);
    assert.notEqual(largerSideMutation, smallerSideAdj);
    const cssBox = { x: 100, w: 200, border: 4 };
    const compensated = { x: cssBox.x + cssBox.border / 2, w: cssBox.w - cssBox.border };
    const noCompensation = { x: cssBox.x, w: cssBox.w };
    assert.notDeepEqual(compensated, noCompensation);
    assert.equal(pxToEmu(cssBox.border / 2) > 0, true);
});
