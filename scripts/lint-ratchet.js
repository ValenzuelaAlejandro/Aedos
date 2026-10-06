const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'tmp', 'lint-report.json');
const baselinePath = path.join(root, 'tests', 'baseline', 'lint-baseline.json');
const writeBaseline = process.argv.includes('--write');

function runLint() {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const result = spawnSync(process.execPath, [
        path.join(path.dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js'),
        '.',
        '--format',
        'json',
        '--output-file',
        reportPath,
    ], { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (!fs.existsSync(reportPath)) throw new Error('ESLint did not produce a report');
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function summarize(report) {
    const byRule = {};
    const byFile = {};
    for (const item of report) {
        const warnings = item.messages.filter((message) => message.severity === 1);
        const file = path.relative(root, item.filePath).split(path.sep).join('/');
        if (warnings.length) byFile[file] = warnings.length;
        for (const warning of warnings) {
            const rule = warning.ruleId || 'unclassified';
            byRule[rule] = (byRule[rule] || 0) + 1;
        }
    }
    return {
        totalWarnings: Object.values(byFile).reduce((sum, count) => sum + count, 0),
        byRule,
        byFile,
        topFiles: Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
}

const summary = summarize(runLint());
if (writeBaseline || !fs.existsSync(baselinePath)) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Lint baseline written: ${summary.totalWarnings} warnings.`);
    process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
baseline.byFile = Object.fromEntries(
    Object.entries(baseline.byFile).map(([file, count]) => [file.replace(/\\/g, '/'), count]),
);
const increasedRules = Object.keys({ ...baseline.byRule, ...summary.byRule })
    .filter((rule) => (summary.byRule[rule] || 0) > (baseline.byRule[rule] || 0));
const increasedFiles = Object.keys({ ...baseline.byFile, ...summary.byFile })
    .filter((file) => (summary.byFile[file] || 0) > (baseline.byFile[file] || 0));

console.log(`Lint warnings: ${summary.totalWarnings}`);
console.log(`By rule: ${JSON.stringify(summary.byRule)}`);
console.log(`Top files: ${JSON.stringify(summary.topFiles)}`);
if (summary.totalWarnings < baseline.totalWarnings) console.warn('Lint warnings decreased; consider updating the baseline.');
if (increasedRules.length || increasedFiles.length) {
    console.error(`Lint ratchet increased: rules=${increasedRules.join(', ')} files=${increasedFiles.join(', ')}`);
    process.exit(1);
}
