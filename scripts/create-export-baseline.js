const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index < 0 ? null : process.argv[index + 1];
}

const inputDir = path.resolve(
    argumentValue('--input-dir') || path.join(root, 'tmp', 'verify-pptx'),
);
const outputFile = path.resolve(
    argumentValue('--output-file') ||
        path.join(root, 'tests', 'baseline', 'exports', 'manifest.json'),
);

function normalizedXml(buffer) {
    return buffer
        .toString('utf8')
        .replace(/<dcterms:created>.*?<\/dcterms:created>/g, '')
        .replace(/<dcterms:modified>.*?<\/dcterms:modified>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function zipEntries(file) {
    const buffer = fs.readFileSync(file);
    let eocd = -1;
    for (let index = buffer.length - 22; index >= 0; index--) {
        if (buffer.readUInt32LE(index) === 0x06054b50) {
            eocd = index;
            break;
        }
    }
    if (eocd < 0) throw new Error(`Not a ZIP package: ${file}`);
    const count = buffer.readUInt16LE(eocd + 10);
    const directoryOffset = buffer.readUInt32LE(eocd + 16);
    const entries = [];
    let offset = directoryOffset;
    for (let index = 0; index < count; index++) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50)
            throw new Error(`Invalid central directory: ${file}`);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        entries.push(name);
        offset += 46 + nameLength + extraLength + commentLength;
        void compressedSize;
    }
    return entries.sort();
}

function readEntry(file, targetName) {
    const buffer = fs.readFileSync(file);
    let eocd = -1;
    for (let index = buffer.length - 22; index >= 0; index--)
        if (buffer.readUInt32LE(index) === 0x06054b50) {
            eocd = index;
            break;
        }
    const count = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    for (let index = 0; index < count; index++) {
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        const localOffset = buffer.readUInt32LE(offset + 42);
        if (name === targetName) {
            const localNameLength = buffer.readUInt16LE(localOffset + 26);
            const localExtraLength = buffer.readUInt16LE(localOffset + 28);
            const start = localOffset + 30 + localNameLength + localExtraLength;
            const compressed = buffer.subarray(start, start + compressedSize);
            return method === 8 ? zlib.inflateRawSync(compressed) : compressed;
        }
        offset += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error(`Missing ZIP part: ${targetName}`);
}

function manifestFor(file) {
    const entries = zipEntries(file);
    return {
        file: path.basename(file),
        parts: entries,
        slideXml: entries
            .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
            .map((entry) => ({
                part: entry,
                normalizedHash: crypto
                    .createHash('sha256')
                    .update(normalizedXml(readEntry(file, entry)))
                    .digest('hex'),
            })),
    };
}

const files = fs
    .readdirSync(inputDir)
    .filter((name) => name.endsWith('.pptx'))
    .sort();
if (!files.length)
    throw new Error(
        `No PPTX files found in ${path.relative(root, inputDir)}; run npm run verify:pptx first.`,
    );
const manifest = files.map((name) => manifestFor(path.join(inputDir, name)));
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(
    `Export baseline written to ${path.relative(root, outputFile)} (${manifest.length} packages).`,
);
