const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'tmp', 'typecheck-report.json');
const baselinePath = path.join(root, 'tests', 'baseline', 'typecheck-baseline.json');
const writeBaseline = process.argv.includes('--write');

function runTypecheck() {
    const result = spawnSync(process.execPath, [
        path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc'),
        '--project',
        path.join(root, 'tsconfig.json'),
        '--pretty',
        'false',
    ], { cwd: root, encoding: 'utf8' });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const diagnostics = output.split(/\r?\n/).filter((line) => /: error TS\d+: /.test(line));
    fs.writeFileSync(reportPath, `${JSON.stringify(diagnostics, null, 2)}\n`);
    return diagnostics;
}

function summarize(diagnostics) {
    const byFile = {};
    const byCode = {};
    for (const line of diagnostics) {
        const match = line.match(/^(.*)\(\d+,\d+\): error (TS\d+):/);
        const file = match ? path.relative(root, match[1]).split(path.sep).join('/') : 'unparsed';
        const code = match ? match[2] : 'unparsed';
        byFile[file] = (byFile[file] || 0) + 1;
        byCode[code] = (byCode[code] || 0) + 1;
    }
    return { totalErrors: diagnostics.length, byFile, byCode };
}

const summary = summarize(runTypecheck());
if (writeBaseline || !fs.existsSync(baselinePath)) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Type-check baseline written: ${summary.totalErrors} errors.`);
    process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
baseline.byFile = Object.fromEntries(
    Object.entries(baseline.byFile).map(([file, count]) => [file.replace(/\\/g, '/'), count]),
);
console.log(`Type-check errors: ${summary.totalErrors}`);
console.log(`By category: ${JSON.stringify(summary.byCode)}`);
const increasedFiles = Object.keys({ ...baseline.byFile, ...summary.byFile })
    .filter((file) => (summary.byFile[file] || 0) > (baseline.byFile[file] || 0));
const increasedCodes = Object.keys({ ...baseline.byCode, ...summary.byCode })
    .filter((code) => (summary.byCode[code] || 0) > (baseline.byCode[code] || 0));
if (summary.totalErrors < baseline.totalErrors) console.warn('Type-check errors decreased; consider updating the baseline.');
if (increasedFiles.length || increasedCodes.length) {
    console.error(`Type-check ratchet increased: files=${increasedFiles.join(', ')} codes=${increasedCodes.join(', ')}`);
    process.exit(1);
}
