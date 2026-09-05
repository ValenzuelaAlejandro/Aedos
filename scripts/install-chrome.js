#!/usr/bin/env node
/**
 * install-chrome.js
 *
 * Cross-platform installer for `chrome-headless-shell` into `<root>/puppeteer-cache`.
 *
 * Why this file exists:
 * The previous `postinstall` ran `sh scripts/install-chrome.sh || true`, which fails
 * on Windows because `sh` and `true` are not available in cmd.exe.
 * This Node.js script keeps the exact same behavior as `install-chrome.sh`
 * (designed for Render's cache-restoration edge case) but works on Windows, macOS
 * and Linux. It also never fails `npm install`: any error is logged as a warning,
 * equivalent to the old `|| true`.
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';
const rootDir = path.join(__dirname, '..');
const cacheDir = path.join(rootDir, 'puppeteer-cache');
// On Windows the chrome-headless-shell binary is an .exe file.
const binaryName = isWindows ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';

function isFile(fullPath) {
    try {
        return fs.statSync(fullPath).isFile();
    } catch (_) {
        return false;
    }
}

function findBinary(dir) {
    if (!fs.existsSync(dir)) return null;
    let files = [];
    try {
        files = fs.readdirSync(dir, { recursive: true });
    } catch (_) {
        return null;
    }
    for (const rel of files) {
        const full = path.join(dir, String(rel));
        if (path.basename(full) === binaryName && isFile(full)) return full;
    }
    return null;
}

function removeIfExists(...paths) {
    for (const p of paths) {
        try {
            fs.rmSync(p, { recursive: true, force: true });
        } catch (_) {
            // Ignore: stale dirs may not exist or be locked.
        }
    }
}

function main() {
    const existing = findBinary(cacheDir);
    if (existing) {
        console.log(`[chrome-install] Binary already present at: ${existing}`);
        return;
    }

    console.log('[chrome-install] Binary not found. Cleaning stale cache dirs and reinstalling...');

    // Remove stale directories so Puppeteer doesn't skip the download.
    removeIfExists(path.join(cacheDir, 'chrome-headless-shell'), path.join(cacheDir, 'chrome'));

    process.env.PUPPETEER_CACHE_DIR = cacheDir;
    execSync('npx puppeteer browsers install chrome-headless-shell', {
        stdio: 'inherit',
        timeout: 5 * 60 * 1000,
        cwd: rootDir
    });

    // Make all chrome binaries executable (POSIX only; no-op on Windows).
    if (!isWindows && fs.existsSync(cacheDir)) {
        try {
            for (const rel of fs.readdirSync(cacheDir, { recursive: true })) {
                const full = path.join(cacheDir, String(rel));
                const base = path.basename(full);
                if ((base === 'chrome-headless-shell' || base === 'chrome') && isFile(full)) {
                    fs.chmodSync(full, 0o755);
                }
            }
        } catch (_) {
            // Best-effort: chmod is not critical for install to succeed.
        }
    }

    const installed = findBinary(cacheDir);
    if (installed) {
        console.log(`[chrome-install] Successfully installed at: ${installed}`);
    } else {
        console.log('[chrome-install] WARNING: Installation completed but binary not found.');
    }
}

try {
    main();
} catch (err) {
    // Never break `npm install` on any platform (same semantics as `|| true`).
    console.error('[chrome-install] WARNING: Chrome install failed, continuing with npm install:', err.message);
}