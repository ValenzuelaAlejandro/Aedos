const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const zlib = require('node:zlib');
const { PDFArray, PDFDocument, PDFName } = require('pdf-lib');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'pdf-baseline-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(
    path.join(root, 'examples', 'flash', 'como-emprender-un-negocio.html'),
    'utf8',
);
const checkOnly = process.argv.includes('--check');
const { app } = require('../src/backend/server');

function decodePageContents(pdf, page) {
    const contents = page.node.dict.get(PDFName.of('Contents'));
    if (!contents) return [];
    const references = contents instanceof PDFArray ? contents.asArray() : [contents];
    return references.map((reference) => {
        const stream = pdf.context.lookup(reference);
        let bytes = stream.contents;
        const filter = stream.dict.get(PDFName.of('Filter'));
        if (filter?.encodedName === '/FlateDecode') bytes = zlib.inflateSync(bytes);
        return Buffer.from(bytes).toString('latin1');
    });
}

function extractPageText(pdf, page) {
    const operators = decodePageContents(pdf, page).join('\n');
    const text = [];
    for (const match of operators.matchAll(/<([0-9a-f\s]+)>\s*Tj|\(([^)]*)\)\s*Tj/gi)) {
        text.push((match[1] || match[2] || '').replace(/\s+/g, ''));
    }
    return text.join('|');
}

async function main() {
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(`${baseUrl}/finalize`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ html, title: 'pdf baseline' }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.pdfUrl)
            throw new Error(`PDF finalize failed: ${JSON.stringify(payload)}`);
        const fileResponse = await fetch(`${baseUrl}${payload.pdfUrl}`);
        const bytes = Buffer.from(await fileResponse.arrayBuffer());
        const pdf = await PDFDocument.load(bytes);
        const pages = pdf.getPages();
        const pageText = pages.map((page) => extractPageText(pdf, page));
        // pdf-lib exposes these header fields at runtime but marks them private in its declarations.
        // @ts-expect-error The runtime header version is the stable PDF contract we compare here.
        const pdfVersion = `${pdf.context.header.major}.${pdf.context.header.minor}`;
        const manifest = {
            urlShape: '/download/*.pdf?name=pdf%20baseline',
            contentType: fileResponse.headers.get('content-type'),
            signature: bytes.subarray(0, 5).toString('ascii'),
            pdfVersion,
            pages: pages.map((page, index) => ({
                width: page.getWidth(),
                height: page.getHeight(),
                textLength: pageText[index].length,
                textSha256: crypto.createHash('sha256').update(pageText[index]).digest('hex'),
            })),
        };
        const output = path.join(root, 'tests', 'baseline', 'exports', 'pdf-manifest.json');
        if (checkOnly) {
            const expected = JSON.parse(fs.readFileSync(output, 'utf8'));
            if (JSON.stringify(expected) !== JSON.stringify(manifest))
                throw new Error(`PDF baseline differs: ${JSON.stringify({ expected, manifest })}`);
        } else {
            fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
        }
        console.log(JSON.stringify(manifest));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
