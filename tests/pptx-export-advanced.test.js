const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createEditablePptx, tableXml, imageXml } = require('../src/backend/utils/pptx-export');
const { countExportWarnings, normalizeExportWarning } = require('../src/backend/utils/export-warnings');

function readEntry(buffer, target) {
    let offset = 0;
    while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
        const method = buffer.readUInt16LE(offset + 8);
        const size = buffer.readUInt32LE(offset + 18);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
        const start = offset + 30 + nameLength + extraLength;
        if (name === target) {
            const value = buffer.subarray(start, start + size);
            return (method === 8 ? zlib.inflateRawSync(value) : value).toString();
        }
        offset = start + size;
    }
    throw new Error(`${target} not found`);
}

const slide = (overrides = {}) => ({ background: { x: 0, y: 0, w: 12192000, h: 6858000, fill: '#fff' }, shapes: [], images: [], texts: [], ...overrides });

test('native table emits graphicFrame, gridSpan and rowSpan with explicit cell styling', async () => {
    const xml = readEntry(await createEditablePptx([slide({ tables: [{ kind: 'table', x: 100, y: 100, w: 2000000, h: 1000000, columns: [600000, 600000], rows: [{ height: 400000, cells: [{ text: 'Header', colSpan: 2, fill: '#dbeafe' }] }, { height: 600000, cells: [{ text: 'A', rowSpan: 2 }, { text: 'B' }] }] }] })], 'table'), 'ppt/slides/slide1.xml');
    assert.match(xml, /graphicFrame/);
    assert.match(xml, /graphicData uri="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/table"/);
    assert.match(xml, /gridSpan="2"/);
    assert.match(xml, /rowSpan="2"/);
    assert.match(xml, /tblGrid/);
});

test('image crop, opacity and alt description serialize in the expected order', () => {
    const xml = imageXml(2, { x: 0, y: 0, w: 100, h: 100, opacity: .5, crop: { l: 1000, r: 2000, t: 3000, b: 4000 }, descr: 'cover image' }, 'rId1');
    assert.match(xml, /<a:blip r:embed="rId1"><a:alphaModFix amt="50000"\/><\/a:blip><a:srcRect l="1000" t="3000" r="2000" b="4000"\/>/);
    assert.match(xml, /descr="cover image"/);
});

test('warning catalog normalizes and counts structured warnings', () => {
    const warnings = [normalizeExportWarning({ slide: 1, selector: '.x', tipo: 'opacity-group', motivo: 'alpha', fallback: 'per-child' })];
    assert.deepEqual(countExportWarnings(warnings), { 'opacity-group': 1 });
    assert.equal(warnings[0].slide, 1);
    assert.equal(warnings[0].selector, '.x');
});
