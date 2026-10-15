'use strict';

const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const root = path.resolve(__dirname, '../..');
const runtime = path.join(os.tmpdir(), 'aedos-redis-validation-runtime');
const packageDir = path.join(runtime, 'node_modules', 'redis-memory-server');
const binaryDir = path.join(root, 'node_modules', '.cache', 'redis-memory-server', 'redis-binaries', 'stable');
const binary = path.join(binaryDir, 'memurai.exe');

function run(command, args, env = process.env) {
    const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

if (!fs.existsSync(binary)) {
    fs.mkdirSync(runtime, { recursive: true });
    run('npm', ['install', '--prefix', runtime, '--no-save', 'redis-memory-server']);
    if (!fs.existsSync(path.join(packageDir, 'scripts', 'postinstall.js'))) {
        throw new Error('redis-memory-server installer was not found in its temporary runtime.');
    }
    run(process.execPath, [path.join(packageDir, 'scripts', 'postinstall.js')], {
        ...process.env,
        INIT_CWD: root,
    });
}

if (!fs.existsSync(binary)) throw new Error(`Redis-compatible test server was not installed at ${binary}`);
process.stdout.write(`Local Redis test server ready: ${binary}\n`);
