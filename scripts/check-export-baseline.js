const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifestFile = path.join(root, 'tests', 'baseline', 'exports', 'manifest.json');
const expected = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aedos-export-check-'));
const inputDir = path.join(tempDir, 'packages');
const actualManifestFile = path.join(tempDir, 'manifest.json');
const env = {
    ...process.env,
    NODE_ENV: 'test',
    GEMINI_API_KEY: 'ci-stub',
    OPENROUTER_API_KEY: 'ci-stub',
    AEDOS_TEST_STUB_PROVIDERS: '1',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
};

function run(script, args) {
    const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
        cwd: root,
        env,
        encoding: 'utf8',
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`);
}

function normalizedXml(buffer) {
    return buffer
        .toString('utf8')
        .replace(/<dcterms:created>.*?<\/dcterms:created>/g, '')
        .replace(/<dcterms:modified>.*?<\/dcterms:modified>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

try {
    run('verify-pptx-export.js', ['--skip-com', '--output-dir', inputDir]);
    run('create-export-baseline.js', [
        '--input-dir',
        inputDir,
        '--output-file',
        actualManifestFile,
    ]);
} catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.error(error.stack || error);
    process.exit(1);
}

try {
    const actualNames = fs
        .readdirSync(inputDir)
        .filter((name) => name.endsWith('.pptx'))
        .sort();
    if (
        actualNames.join('\n') !==
        expected
            .map((item) => item.file)
            .sort()
            .join('\n')
    ) {
        throw new Error('PPTX baseline package list differs.');
    }
    for (const item of expected) {
        const file = path.join(inputDir, item.file);
        const buffer = fs.readFileSync(file);
        const found = [];
        const contents = new Map();
        let eocd = -1;
        for (let index = buffer.length - 22; index >= 0; index--)
            if (buffer.readUInt32LE(index) === 0x06054b50) {
                eocd = index;
                break;
            }
        const count = buffer.readUInt16LE(eocd + 10);
        let offset = buffer.readUInt32LE(eocd + 16);
        for (let index = 0; index < count; index++) {
            const nameLength = buffer.readUInt16LE(offset + 28);
            const extraLength = buffer.readUInt16LE(offset + 30);
            const commentLength = buffer.readUInt16LE(offset + 32);
            const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
            found.push(name);
            const method = buffer.readUInt16LE(offset + 10);
            const compressedSize = buffer.readUInt32LE(offset + 20);
            const localOffset = buffer.readUInt32LE(offset + 42);
            const localNameLength = buffer.readUInt16LE(localOffset + 26);
            const localExtraLength = buffer.readUInt16LE(localOffset + 28);
            const start = localOffset + 30 + localNameLength + localExtraLength;
            const compressed = buffer.subarray(start, start + compressedSize);
            contents.set(name, method === 8 ? zlib.inflateRawSync(compressed) : compressed);
            offset += 46 + nameLength + extraLength + commentLength;
        }
        if (found.sort().join('\n') !== item.parts.join('\n'))
            throw new Error(`PPTX parts differ: ${item.file}`);
        for (const slide of item.slideXml) {
            const xml = normalizedXml(contents.get(slide.part));
            const hash = crypto.createHash('sha256').update(xml).digest('hex');
            if (hash !== slide.normalizedHash)
                throw new Error(`Slide manifest differs: ${item.file}/${slide.part}`);
        }
    }
    const actualManifest = JSON.parse(fs.readFileSync(actualManifestFile, 'utf8'));
    if (JSON.stringify(actualManifest) !== JSON.stringify(expected))
        throw new Error('PPTX export manifest differs.');
    console.log(`PPTX baseline OK: ${expected.length} packages.`);
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
