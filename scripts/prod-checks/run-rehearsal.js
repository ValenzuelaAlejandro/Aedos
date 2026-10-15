'use strict';

const { fork, spawn } = require('node:child_process');
const path = require('node:path');
const { once } = require('node:events');

async function runRehearsal() {
    // Start from a clean environment: real credentials and budget overrides are
    // never inherited by the rehearsal, including .env/.env.preprod values.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        /^(?:PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|npm_execpath)$/i.test(key)));
    Object.assign(env, { NODE_ENV: 'preproduction', GEMINI_API_KEY: 'rehearsal-valid-key',
        AEDOS_GEMINI_429_API_KEY: 'rehearsal-low-quota', OPENROUTER_API_KEY: 'rehearsal-openrouter-key',
        UPSTASH_REDIS_REST_URL: 'https://rehearsal.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'rehearsal-redis-token',
        AEDOS_REDIS_TEST_LABEL: 'staging-rehearsal', AEDOS_LIVE_REDIS_LABEL: 'staging-rehearsal',
        AEDOS_REDIS_TEST_ACK: 'ISOLATED_PREPRODUCTION_REDIS_ONLY',
        AEDOS_LIVE_TEST_ACK: 'ISOLATED_PREPRODUCTION_ONLY', AEDOS_PREPROD_VERIFICATION_ACK: 'ISOLATED_PREPRODUCTION_ONLY',
    });
    const guard = path.resolve(__dirname, 'rehearsal-network.js');
    const fixture = fork(path.join(__dirname, 'rehearsal-server.js'), [], { env,
        execArgv: ['--require', guard], stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
    try {
        const [addresses] = await Promise.race([once(fixture, 'message'), once(fixture, 'exit').then(() => { throw new Error('Rehearsal fixture exited before readiness.'); })]);
        Object.assign(env, { AEDOS_REHEARSAL_TRANSPORT: addresses.transport, AEDOS_PREPROD_URL: addresses.target,
            NODE_OPTIONS: `--require="${guard.replace(/\\/g, '/')}"`, AEDOS_REHEARSAL_CHILD: '1' });
        const suite = spawn(process.execPath, [path.join(__dirname, 'run-preprod-suite.js')], {
            env, stdio: 'inherit', windowsHide: true,
        });
        const [code] = await once(suite, 'exit');
        if (code !== 0) throw new Error(`Rehearsal failed (exit ${code}).`);
    } finally {
        if (fixture.connected) { fixture.send('close'); await once(fixture, 'exit'); }
    }
}
module.exports = { runRehearsal };
