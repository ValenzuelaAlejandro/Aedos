const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createEditablePptx } = require('../src/backend/utils/pptx-export');

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

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function namesFor(items, extra = {}) {
    const pptx = await createEditablePptx([{
        background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#101114', name: 'Slide background' },
        shapes: [], images: [], texts: [], items, ...extra
    }], 'layer test');
    const xml = readZipEntries(pptx).get('ppt/slides/slide1.xml');
    return [...xml.matchAll(/<p:(?:nvSpPr|nvPicPr)><p:cNvPr id="\d+" name="([^"]+)"/g)].map(match => match[1]);
}

function text(name, zKey, domIndex) {
    return { kind: 'text', name, text: name, fontSize: 16, fontFace: 'Arial', x: 0, y: 0, w: 1000000, h: 300000, zKey, domIndex };
}

function shape(name, zKey, domIndex) {
    return { kind: 'shape', name, fill: '#D4A800', x: 0, y: 0, w: 1000000, h: 300000, zKey, domIndex };
}

test('A: text below a higher-z image is emitted before the image', async () => {
    const names = await namesFor([
        text('Text below image', [0, 0, 10, 2], 10),
        { kind: 'image', name: 'Image above', data: png, x: 0, y: 0, w: 1000000, h: 300000, zKey: [1, 5, 20, 2], domIndex: 20 }
    ]);
    assert.deepEqual(names.slice(-2), ['Text below image', 'Image above']);
});

test('B: overlapping cards keep each card background immediately before its text', async () => {
    const names = await namesFor([
        shape('Card 1', [0, 0, 10, 0], 10),
        text('Text 1', [0, 0, 10, 1], 10),
        shape('Card 2', [0, 0, 20, 0], 20),
        text('Text 2', [0, 0, 20, 1], 20)
    ]);
    assert.deepEqual(names.slice(-4), ['Card 1', 'Text 1', 'Card 2', 'Text 2']);
});

test('C: a negative z-index stays behind normal content but after the slide background', async () => {
    const names = await namesFor([
        shape('Negative', [-1, -1, 10, 0], 10),
        shape('Normal', [0, 0, 20, 0], 20)
    ]);
    assert.deepEqual(names.slice(-2), ['Negative', 'Normal']);
});

test('D: a high child inside a low stacking context cannot outrank a higher context', async () => {
    const names = await namesFor([
        text('High child in low context', [0, 1, 10, 1, 100, 1], 100),
        shape('High context', [1, 5, 20, 0], 20)
    ]);
    assert.deepEqual(names.slice(-2), ['High child in low context', 'High context']);
});

test('E: before decoration is behind content and after decoration is above it', async () => {
    const names = await namesFor([
        shape('Before decoration', [0, 1, 10, 0], 10),
        text('Content', [0, 2, 11, 1], 11),
        shape('After decoration', [0, 3, 12, 0], 12)
    ]);
    assert.deepEqual(names.slice(-3), ['Before decoration', 'Content', 'After decoration']);
});
