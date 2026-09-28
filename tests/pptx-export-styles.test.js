const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createEditablePptx, parseCssGradient } = require('../src/backend/utils/pptx-export');

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

test('linear gradient maps CSS angles and distributes stops', () => {
    const cases = [
        ['0deg', 0],
        ['90deg', 90],
        ['180deg', 180],
        ['45deg', 45]
    ];
    for (const [angle, expected] of cases) assert.equal(parseCssGradient(`linear-gradient(${angle}, #000 0%, #fff 100%)`).angle, expected);
    const diagonal = parseCssGradient('linear-gradient(to bottom right, #000, #888, #fff)', { width: 200, height: 100 });
    assert.ok(Math.abs(diagonal.angle - 116.565) < 0.01);
    assert.deepEqual(diagonal.stops.map(stop => stop.position), [0, 0.5, 1]);
});

test('gradient transparency preserves alpha and transparent adopts a neighboring color', () => {
    const gradient = parseCssGradient('linear-gradient(90deg, transparent 0%, #ffffff 100%)');
    assert.equal(gradient.stops[0].hex, 'FFFFFF');
    assert.equal(gradient.stops[0].alpha, 0);
    const rgba = parseCssGradient('linear-gradient(90deg, rgba(0,0,0,0) 0%, #ffffff 100%)');
    assert.equal(rgba.stops[0].hex, 'FFFFFF');
    assert.equal(rgba.stops[0].alpha, 0);
});

test('gradient alpha handles adjacent transparent stops, explicit positions and monotonic correction', () => {
    const edge = parseCssGradient('linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 25%, #00ff00 50%, rgba(0,0,0,0) 100%)');
    assert.deepEqual(edge.stops.map(stop => stop.hex), ['00FF00', '00FF00', '00FF00', '00FF00']);
    assert.deepEqual(edge.stops.map(stop => stop.alpha), [0, 0, 1, 0]);
    const nonMonotonic = parseCssGradient('linear-gradient(90deg, #f00 80%, #0f0 20%, #00f)');
    assert.deepEqual(nonMonotonic.stops.map(stop => stop.position), [0.8, 0.8, 1]);
    assert.ok(nonMonotonic.stops.every((stop, index, stops) => index === 0 || stop.position >= stops[index - 1].position));
});

test('gradient alpha mutation sentinel rejects a black transparent RGB stop', () => {
    const gradient = parseCssGradient('linear-gradient(90deg, rgba(0,0,0,0), #ffffff)');
    assert.equal(gradient.stops[0].hex, 'FFFFFF');
    const mutated = gradient.stops.map(stop => ({ ...stop }));
    mutated[0].hex = '000000';
    assert.notDeepEqual(mutated, gradient.stops);
});

test('radial gradient emits native path fill and unsupported repeating gradients are rejected', async () => {
    const radial = parseCssGradient('radial-gradient(circle, #000 0%, #fff 100%)');
    assert.equal(radial.type, 'radial');
    assert.equal(parseCssGradient('repeating-linear-gradient(90deg, #000, #fff)'), null);
    assert.equal(parseCssGradient('linear-gradient(90deg, #000, #fff), linear-gradient(0deg, #f00, #00f)'), null);
    const radialPptx = await createEditablePptx([{
        background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#FFFFFF' },
        shapes: [{ x: 0, y: 0, w: 5000000, h: 3000000, fill: '#000000', gradient: 'radial-gradient(circle, #000 0%, #fff 100%)', name: 'Radial gradient' }],
        images: [], texts: []
    }], 'radial gradient test');
    const radialSlide = readSlide(radialPptx);
    assert.match(radialSlide, /<a:path path="circle">/);
    assert.match(radialSlide, /<a:fillToRect l="0" t="0" r="0" b="0"\/>/);
    const pptx = await createEditablePptx([{
        background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#FFFFFF' },
        shapes: [{ x: 0, y: 0, w: 5000000, h: 3000000, fill: '#000000', gradient: 'linear-gradient(90deg, #000 0%, rgba(255,0,0,.5) 100%)', name: 'Gradient' }],
        images: [], texts: []
    }], 'gradient test');
    const slide = readSlide(pptx);
    assert.match(slide, /<a:gradFill rotWithShape="1">/);
    assert.match(slide, /<a:gsLst>/);
    assert.match(slide, /<a:lin ang="0" scaled="0"\/>/);
    assert.match(slide, /<a:alpha val="50000"\/>/);
});
