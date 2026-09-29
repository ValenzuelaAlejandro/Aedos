const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'src', 'frontend', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const declaredIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
// These selectors target generated iframe/tool markup or legacy optional UI,
// not the static page. They are documented here so the check remains useful
// without falsely treating runtime-generated editor controls as missing.
const nonStaticIds = new Set([
    'editor-btn-size-down', 'editor-btn-size-up', 'editor-btn-text-color',
    'editor-btn-bg-color', 'editor-btn-delete', 'editor-btn-duplicate',
    'editor-btn-replace-img', 'editor-tb-size-val', 'editor-color-picker',
    'temp-skeleton', 'tool-bg-color', 'tool-add-slide-alt', 'lib-back-btn',
    'tool-font-size', 'tool-font-add', 'tool-font-min', 'tool-bold',
    'tool-italic', 'tool-under', 'tool-color', 'tool-align-l', 'tool-align-c',
    'tool-align-r', 'tool-font-picker', 'tool-font-trigger', 'tool-font-dropdown',
    'tool-font-label', 'tool-replace-img', 'tool-radius', 'tool-opacity',
    'tool-fill', 'tool-stroke', 'tool-icon-size', 'tool-layer-up',
    'tool-layer-down', 'tool-delete', 'loading-progress-bar',
    'preview-theme-toggle-btn', 'btn-edit-topic'
]);
function javascriptFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...javascriptFiles(fullPath));
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
    }
    return files;
}

const frontendFiles = javascriptFiles(path.join(root, 'src', 'frontend'));
const references = new Map();

function record(id, file, line) {
    if (!references.has(id)) references.set(id, []);
    references.get(id).push(`${path.relative(root, file)}:${line}`);
}

for (const file of frontendFiles) {
    const source = fs.readFileSync(file, 'utf8');
    source.split(/\r?\n/).forEach((lineText, index) => {
        for (const match of lineText.matchAll(/getElementById\(\s*["']([^"']+)["']/g)) record(match[1], file, index + 1);
        for (const match of lineText.matchAll(/querySelector(?:All)?\(\s*["']#([A-Za-z0-9_-]+)/g)) record(match[1], file, index + 1);
    });
}

const missing = [...references.entries()].filter(([id]) => !declaredIds.has(id) && !nonStaticIds.has(id));
if (missing.length) {
    console.error('DOM contract violations:');
    for (const [id, locations] of missing) console.error(`- #${id}: ${locations.join(', ')}`);
    process.exitCode = 1;
} else {
    console.log(`DOM contract OK: ${references.size} static IDs checked.`);
}
