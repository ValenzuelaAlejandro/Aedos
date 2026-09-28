const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
    createEditablePptx,
    pxToEmu,
    CSS_BLUR_TO_SHADOW_RAD,
    analyzeCssShadow,
    shadowEffectXml
} = require('../src/backend/utils/pptx-export');

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

function baseSlide(overrides = {}) {
    return {
        background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#FFFFFF' },
        shapes: [], images: [], texts: [], ...overrides
    };
}

test('outerShdw converts offsets, direction, blur and alpha', () => {
    const shadow = 'rgba(0, 0, 0, 0.45) 0 4px 12px';
    const xml = shadowEffectXml(shadow);
    assert.match(xml, /<a:outerShdw[^>]*blurRad="\d+"[^>]*dist="\d+"[^>]*dir="5400000"/);
    assert.match(xml, new RegExp(`blurRad="${Math.round(pxToEmu(12) * CSS_BLUR_TO_SHADOW_RAD)}"`));
    assert.match(xml, new RegExp(`dist="${Math.round(pxToEmu(4, 'y'))}"`));
    assert.match(xml, /<a:srgbClr val="000000"><a:alpha val="45000"\/>/);

    assert.match(shadowEffectXml('rgba(0, 0, 0, 0.45) 4px 0 8px'), /dir="0"/);
    assert.match(shadowEffectXml('rgba(0, 0, 0, 0.45) -3px -3px 6px'), /dir="13500000"/);
});

test('ring shadow becomes an editable border and is not emitted as outerShdw', async () => {
    const analysis = analyzeCssShadow('0 0 0 3px rgba(255, 0, 0, .7)');
    assert.equal(analysis.ring.spreadPx, 3);
    assert.equal(shadowEffectXml(analysis), '');
    const xml = readSlide(await createEditablePptx([baseSlide({ shapes: [{
        x: 0, y: 0, w: 1000000, h: 1000000, fill: '#FFFFFF', shadow: '0 0 0 3px rgba(255, 0, 0, .7)'
    }] })], 'ring'));
    assert.match(xml, /<a:ln w="[1-9]\d*"><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="70000"\/><\/a:srgbClr><\/a:solidFill><\/a:ln>/);
    assert.doesNotMatch(xml, /outerShdw/);
});

test('multiple and inset shadows select the dominant shadow and expose warnings', () => {
    const multiple = analyzeCssShadow('0 4px 12px rgba(0,0,0,.4), 0 0 2px rgba(255,0,0,.9)');
    assert.equal(multiple.dominant.blurPx, 12);
    assert.equal(multiple.warnings[0].fallback, 'aplicar la sombra dominante alpha×blur');
    const inset = analyzeCssShadow('inset 0 2px 6px rgba(0,0,0,.5)');
    assert.equal(inset.dominant.inset, true);
    assert.match(shadowEffectXml(inset), /outerShdw/);
    assert.equal(inset.warnings[0].fallback, 'aplicar la sombra dominante como outerShdw');
});

test('text-shadow is placed in a run effectLst', async () => {
    const xml = readSlide(await createEditablePptx([baseSlide({ texts: [{
        x: 0, y: 0, w: 2000000, h: 600000, kind: 'text', text: 'Shadow', fontSize: 24,
        textColor: '#111111', fontFace: 'Arial', textShadow: 'rgba(0,0,0,.5) 2px 2px 3px'
    }] })], 'text shadow'));
    assert.match(xml, /<a:rPr[^>]*><a:solidFill>.*?<\/a:solidFill><a:effectLst><a:outerShdw/);
});

test('mutation sentinel rejects a reversed shadow direction', () => {
    const xml = shadowEffectXml('rgba(0,0,0,.5) 0 4px 12px');
    const mutated = xml.replace('dir="5400000"', 'dir="-5400000"');
    assert.match(xml, /dir="5400000"/);
    assert.notEqual(mutated, xml);
    assert.doesNotMatch(mutated, /dir="5400000"/);
});

test('effectLst follows ln inside spPr and ids remain unique', async () => {
    const xml = readSlide(await createEditablePptx([baseSlide({ shapes: [{
        x: 0, y: 0, w: 1000000, h: 1000000, fill: '#FFFFFF', borderColor: '#000000', borderWidth: 1,
        shadow: 'rgba(0,0,0,.4) 4px 0 8px'
    }] })], 'structure'));
    assert.match(xml, /<a:ln[^>]*>.*?<\/a:ln><a:effectLst>/);
    const ids = [...xml.matchAll(/cNvPr id="(\d+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
});
