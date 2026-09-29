const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'sanitization-stub';
const { sanitizeGeneratedHtml } = require('../src/backend/server');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'tests', 'fixtures', 'sanitization');
fs.mkdirSync(dir, { recursive: true });

const cases = {
    script: '<section class="s"><script>alert(1)</script><p>safe</p></section>',
    handlers: '<section class="s" onclick="bad()" onerror=bad onload="bad"><p>safe</p></section>',
    javascript_urls: '<a href="javascript:alert(1)"><img src="javascript:bad" /></a>',
    data_urls: '<img src="data:text/html,<script>alert(1)</script>"><img src="data:image/png;base64,AAAA">',
    embedded: '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x">',
    style_import_url: '<style>@import url(https://evil.test/x.css); .x{background:url(javascript:bad)}</style>',
    svg_script: '<svg><script>alert(1)</script><circle /></svg>',
    conditional_comment: '<!--[if IE]><script>alert(1)</script><![endif]--><p>safe</p>',
    malformed: '<div><p>safe<script>bad</script><p>still safe',
    entities: '<p title="&quot; onclick=&quot;bad">&lt;safe&gt; &amp; text</p>',
    mixed_case: '<ScRiPt>alert(1)</ScRiPt><DIV OnClIcK="bad()">safe</DIV>',
    style_attribute: '<div style="background:url(javascript:bad);color:red" onmouseover="bad()">safe</div>'
};

for (const [name, input] of Object.entries(cases)) {
    fs.writeFileSync(path.join(dir, `${name}.input.html`), input + '\n');
    fs.writeFileSync(path.join(dir, `${name}.output.html`), sanitizeGeneratedHtml(input) + '\n');
}

for (const relative of ['examples/flash/como-emprender-un-negocio.html', 'examples/pro/como-aprender-java-tu-guia-paso-a-paso.html']) {
    const input = fs.readFileSync(path.join(root, relative));
    const output = sanitizeGeneratedHtml(input.toString());
    const name = path.basename(relative, '.html');
    fs.writeFileSync(path.join(dir, `${name}.input.html`), input);
    fs.writeFileSync(path.join(dir, `${name}.output.html`), output);
    fs.writeFileSync(path.join(dir, `${name}.sha256`), crypto.createHash('sha256').update(output).digest('hex') + '\n');
}

console.log(`Generated ${Object.keys(cases).length + 2} sanitization fixture pairs in ${path.relative(root, dir)}.`);
setImmediate(() => process.exit(0));
