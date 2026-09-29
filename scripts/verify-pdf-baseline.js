const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'pdf-baseline-stub';
process.env.AEDOS_TEST_STUB_PROVIDERS = '1';

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'examples', 'flash', 'como-emprender-un-negocio.html'), 'utf8');
const checkOnly = process.argv.includes('--check');
const { app } = require('../src/backend/server');

async function main() {
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(`${baseUrl}/finalize`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ html, title: 'pdf baseline' })
        });
        const payload = await response.json();
        if (!response.ok || !payload.pdfUrl) throw new Error(`PDF finalize failed: ${JSON.stringify(payload)}`);
        const fileResponse = await fetch(`${baseUrl}${payload.pdfUrl}`);
        const bytes = Buffer.from(await fileResponse.arrayBuffer());
        const pdf = await PDFDocument.load(bytes);
        const firstPage = pdf.getPages()[0];
        const manifest = {
            urlShape: '/download/*.pdf?name=pdf%20baseline',
            contentType: fileResponse.headers.get('content-type'),
            signature: bytes.subarray(0, 5).toString('ascii'),
            bytes: bytes.length,
            pages: pdf.getPageCount(),
            width: firstPage.getWidth(),
            height: firstPage.getHeight()
        };
        const output = path.join(root, 'tests', 'baseline', 'exports', 'pdf-manifest.json');
        if (checkOnly) {
            const expected = JSON.parse(fs.readFileSync(output, 'utf8'));
            if (JSON.stringify(expected) !== JSON.stringify(manifest)) throw new Error(`PDF baseline differs: ${JSON.stringify({ expected, manifest })}`);
        } else {
            fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
        }
        console.log(JSON.stringify(manifest));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

main().then(() => process.exit(0)).catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
