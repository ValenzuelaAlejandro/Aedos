const { spawnSync } = require('node:child_process');
const path = require('node:path');

const files = [
    'scripts/generate-sanitization-fixtures.js',
    'scripts/verify-pdf-baseline.js',
    'tests/contracts/stub-guard.test.js',
    'tests/sanitization/sanitization.test.js',
].map((file) => path.resolve(__dirname, '..', file));
const write = process.argv.includes('--write');
const result = spawnSync(process.execPath, [require.resolve('prettier/bin/prettier.cjs'), ...(write ? ['--write'] : ['--check']), ...files], {
    stdio: 'inherit',
});
process.exit(result.status || 0);
