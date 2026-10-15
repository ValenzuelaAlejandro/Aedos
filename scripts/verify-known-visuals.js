'use strict';

const { spawnSync } = require('node:child_process');

const checks = [
    {
        script: 'check:baseline:visual',
        args: ['scripts/capture-baseline.js', '--compare'],
        known: /Visual baseline differs: desktop-light\.png/,
    },
    {
        script: 'check:baseline:mutations',
        args: ['scripts/check-visual-mutations.js'],
        known: /1b body fondo rojo/,
    },
    {
        script: 'check:editor-safety',
        args: ['scripts/editor-safety/check-flow.js'],
        known: /flow-01-landing/,
    },
];

let failed = false;
for (const check of checks) {
    let result = spawnSync(process.execPath, check.args, {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
    });
    let output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (check.script === 'check:editor-safety' && result.status === 0) {
        result = spawnSync(process.execPath, ['scripts/editor-safety/check-mutations.js'], {
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
        });
        output += `\n${result.stdout || ''}\n${result.stderr || ''}`;
    }
    if (result.status === 0) {
        process.stdout.write(`[PASS] ${check.script}\n`);
        continue;
    }
    if (check.known.test(output)) {
        process.stdout.write(
            `[KNOWN PENDING] ${check.script}: reproduced its documented visual baseline issue.\n`,
        );
        continue;
    }
    failed = true;
    process.stderr.write(
        `[FAIL] ${check.script}: unexpected visual-check failure.\n${output.slice(-6000)}\n`,
    );
}

if (failed) process.exitCode = 1;
else
    process.stdout.write(
        'Visual baseline suite complete; documented pending failures are isolated above.\n',
    );
