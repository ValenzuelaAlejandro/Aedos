/* eslint-disable max-lines-per-function */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

/**
 * Owns the singleton Puppeteer browser and its cache self-healing lifecycle.
 * The caller still decides when initBrowser() is invoked so import and startup
 * timing remain part of the server contract.
 */
function createBrowserManager({ rootDir, puppeteerLog, ErrorCategory }) {
    let browser;

    /**
     * Tentatively finds the Chrome executable in the cache directory.
     * Puppeteer's default resolution can fail on Render's filesystem structure.
     */
    function findChromeExecutable(cacheDir) {
        if (!fs.existsSync(cacheDir)) return null;

        function isFile(fullPath) {
            try {
                return fs.statSync(fullPath).isFile();
            } catch (_) {
                return false;
            }
        }

        try {
            const files = fs.readdirSync(cacheDir, { recursive: true });
            const shell = files.find(f => {
                const base = path.basename(String(f));
                if (base !== 'chrome-headless-shell' && base !== 'chrome-headless-shell.exe') return false;
                if (String(f).includes('.zip')) return false;
                return isFile(path.join(cacheDir, String(f)));
            });
            if (shell) return path.join(cacheDir, String(shell));

            const chrome = files.find(f => {
                const base = path.basename(String(f));
                if (base !== 'chrome' && base !== 'chrome.exe') return false;
                if (String(f).includes('.zip')) return false;
                if (String(f).includes('chrome-headless-shell')) return false;
                return isFile(path.join(cacheDir, String(f)));
            });
            if (chrome) return path.join(cacheDir, String(chrome));
        } catch (e) {
            return null;
        }
        return null;
    }

    function extractChromeFromZip(cacheDir) {
        if (process.platform === 'win32') return;
        if (!fs.existsSync(cacheDir)) return;
        if (findChromeExecutable(cacheDir)) return;

        const shellCacheDir = path.join(cacheDir, 'chrome-headless-shell');
        if (!fs.existsSync(shellCacheDir)) return;

        let zipFile;
        try {
            zipFile = fs.readdirSync(shellCacheDir).find(
                f => f.endsWith('.zip') && f.includes('chrome-headless-shell')
            );
        } catch (_) { return; }
        if (!zipFile) return;

        const versionMatch = zipFile.match(/^([\d.]+)-chrome-headless-shell-linux64\.zip$/);
        if (!versionMatch) return;

        const version = versionMatch[1];
        const zipPath = path.join(shellCacheDir, zipFile);
        const extractTo = path.join(shellCacheDir, `linux-${version}`);

        puppeteerLog.warn(ErrorCategory.PUPPETEER,
            'Chrome binary missing from cache — extracting from cached ZIP', {
            zip: zipPath,
            extractTo
        }
        );

        try {
            execSync(`unzip -o "${zipPath}" -d "${extractTo}"`, { stdio: 'pipe', timeout: 60000 });
            execSync(
                `find "${extractTo}" -type f -name 'chrome-headless-shell' -exec chmod +x {} +`,
                { stdio: 'pipe', timeout: 10000 }
            );
            execSync(
                `find "${extractTo}" -type f -name 'chrome' -exec chmod +x {} +`,
                { stdio: 'pipe', timeout: 10000 }
            );
            puppeteerLog.info(ErrorCategory.PUPPETEER, 'Chrome binary extracted and made executable', {
                version,
                path: extractTo
            });
        } catch (err) {
            puppeteerLog.error(ErrorCategory.PUPPETEER, 'Failed to extract Chrome binary from ZIP', {
                error: err.message
            });
        }
    }

    async function installChrome(cacheDir) {
        puppeteerLog.warn(ErrorCategory.PUPPETEER, 'Chrome binary not found — attempting runtime install', { cacheDir });
        try {
            const { execSync: execSyncInstall } = require('child_process');
            const staleHeadless = path.join(cacheDir, 'chrome-headless-shell');
            const staleChrome = path.join(cacheDir, 'chrome');
            if (fs.existsSync(staleHeadless)) {
                fs.rmSync(staleHeadless, { recursive: true, force: true });
                puppeteerLog.info(ErrorCategory.PUPPETEER, 'Removed stale chrome-headless-shell dir before reinstall');
            }
            if (fs.existsSync(staleChrome)) {
                fs.rmSync(staleChrome, { recursive: true, force: true });
                puppeteerLog.info(ErrorCategory.PUPPETEER, 'Removed stale chrome dir before reinstall');
            }

            execSyncInstall(
                'npx puppeteer browsers install chrome-headless-shell',
                {
                    stdio: 'pipe',
                    timeout: 5 * 60 * 1000,
                    cwd: rootDir,
                    env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir }
                }
            );
            puppeteerLog.info(ErrorCategory.PUPPETEER, 'Chrome runtime install completed');
        } catch (installErr) {
            puppeteerLog.error(ErrorCategory.PUPPETEER, 'Chrome runtime install failed', { error: installErr.message });
        }
    }

    async function initBrowser() {
        try {
            const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(rootDir, 'puppeteer-cache');
            extractChromeFromZip(cacheDir);

            let autoExecutablePath = findChromeExecutable(cacheDir);
            if (!autoExecutablePath && !process.env.PUPPETEER_EXECUTABLE_PATH) {
                await installChrome(cacheDir);
                autoExecutablePath = findChromeExecutable(cacheDir);
            }

            /** @type {import('puppeteer').LaunchOptions} */
            const launchOptions = {
                // @ts-expect-error Puppeteer accepts the runtime-compatible "new" headless mode.
                headless: 'new',
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || autoExecutablePath || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-ipv6',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--disable-extensions',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--lang=es-ES,es;q=0.9,en;q=0.8'
                ]
            };

            if (launchOptions.executablePath) {
                puppeteerLog.info(ErrorCategory.PUPPETEER, 'Launching Puppeteer with explicit path', {
                    path: launchOptions.executablePath
                });
                try {
                    fs.chmodSync(launchOptions.executablePath, 0o755);
                    puppeteerLog.info(ErrorCategory.PUPPETEER, 'Chrome binary chmod 755 applied');
                } catch (chmodErr) {
                    puppeteerLog.warn(ErrorCategory.PUPPETEER, 'chmod on Chrome binary failed (non-fatal)', {
                        error: chmodErr.message
                    });
                }
            }

            browser = await puppeteer.launch(launchOptions);
            puppeteerLog.success(ErrorCategory.PUPPETEER, 'Puppeteer browser initialized');
        } catch (error) {
            const cacheDebug = {};
            try {
                const cachePath = process.env.PUPPETEER_CACHE_DIR || path.join(rootDir, 'puppeteer-cache');
                cacheDebug.configuredPath = cachePath;
                if (fs.existsSync(cachePath)) {
                    cacheDebug.exists = true;
                    cacheDebug.contents = fs.readdirSync(cachePath, { recursive: true }).slice(0, 30);
                } else {
                    cacheDebug.exists = false;
                    cacheDebug.oldPathExists = fs.existsSync(path.join(rootDir, '.cache', 'puppeteer'));
                }
            } catch (e) {
                cacheDebug.error = e.message;
            }

            puppeteerLog.error(ErrorCategory.PUPPETEER, 'Failed to initialize Puppeteer browser', {
                error,
                cacheDebug,
                envExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH
            });
        }
    }

    return {
        getBrowser: () => browser,
        initBrowser,
        close: async () => {
            if (browser) {
                await browser.close();
                puppeteerLog.info(ErrorCategory.PUPPETEER, 'Puppeteer browser closed');
            }
        }
    };
}

module.exports = { createBrowserManager };
