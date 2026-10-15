'use strict';
require('./redacted-output');

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { validatePreproductionInputs, verifyPreproductionServer } = require('./preproduction-safety');

const root = path.resolve(__dirname, '../..');
function preflight() {
    try { validatePreproductionInputs(); return true; }
    catch (error) {
        process.stderr.write(error.message + '\n');
        return false;
    }
}

function run(label, command, args, env = process.env) {
    process.stdout.write(`\n[RUN] ${label}\n`);
    const npmRun = command === 'npm';
    const executable = npmRun ? process.execPath : command;
    const commandArgs = npmRun ? [process.env.npm_execpath, ...args] : args;
    if (npmRun && !process.env.npm_execpath) {
        throw new Error('Run this suite as `npm run verify:preprod` so npm can be invoked safely.');
    }
    const result = spawnSync(executable, commandArgs, {
        cwd: root,
        env,
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
        throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
    process.stdout.write(`[PASS] ${label}\n`);
}

async function main() {
    if (process.argv.includes('--rehearsal')) return require('./run-rehearsal').runRehearsal();
    if (!process.env.AEDOS_REHEARSAL_CHILD) {
        const loaded = require('dotenv').config({ path: path.join(root, '.env.preprod'), override: true, quiet: true });
        if (loaded.error) {
            process.stderr.write('Missing or unreadable local .env.preprod; no network checks were started.\n');
            process.exitCode = 2;
            return;
        }
        // Never fill omitted file credentials with an ambient production key.
        const { REQUIRED_INPUTS } = require('./preproduction-safety');
        for (const key of REQUIRED_INPUTS) process.env[key] = loaded.parsed[key] || '';
    }
    if (!preflight()) process.exitCode = 2;
    else {
        try {
            await verifyPreproductionServer();
            run('isolation, external-network guard, secret redaction and policy contracts', process.execPath, [
                '--test', 'tests/contracts/preproduction-safety.test.js',
                'tests/contracts/rehearsal-network.test.js', 'tests/contracts/preproduction-redaction.test.js',
                'tests/contracts/policy-documentation.test.js',
            ]);
            run('synthetic provider fault matrix and accounting', 'npm', [
                'run',
                'test:provider-fallback',
            ]);
            run('local Redis ACL, persistence and restart checks', 'npm', [
                'run',
                'verify:redis:local',
            ]);
            run('isolated preproduction Redis ledger verification', process.execPath, [
                'scripts/prod-checks/verify-redis-isolated.js',
            ]);
            run(
                'live preproduction Gemini SSE smoke',
                process.execPath,
                ['scripts/prod-checks/verify-gemini-preprod.js'],
                { ...process.env, AEDOS_EXPECT_PROVIDER: 'gemini' },
            );
            run(
                'live Gemini/OpenRouter HTTP, 429 and stream-cut checks',
                process.execPath,
                ['scripts/prod-checks/verify-live-provider-fallback.js'],
                { ...process.env, NODE_ENV: 'preproduction' },
            );
            process.stdout.write(
                '\nPreproduction verification passed. No deployment was performed.\n',
            );
        } catch (error) {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        }
    }
}

main().catch(() => { process.stderr.write('Preproduction verification failed; no deployment performed.\n'); process.exitCode = 1; });
