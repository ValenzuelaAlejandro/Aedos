const fs = require('fs');

/**
 * Create the directory helper used by the bootstrap while preserving its log.
 * @param {{log: {info: Function}, ErrorCategory: {FILESYSTEM: string}}} options
 * @returns {(dirPath: string, description: string) => void}
 */
function createDirectoryEnsurer({ log, ErrorCategory }) {
    return function ensureDirectory(dirPath, description) {
        if (fs.existsSync(dirPath)) return;
        fs.mkdirSync(dirPath, { recursive: true });
        log.info(ErrorCategory.FILESYSTEM, `${description} directory created`, { path: dirPath });
    };
}

/**
 * Ensure the backend directories that existed before extraction are created.
 * @param {{tmpDir: string, ensureDirectory: Function}} options
 * @returns {void}
 */
function ensureBackendDirectories(options) {
    const { tmpDir, ensureDirectory } = options;
    ensureDirectory(tmpDir, 'Temporary');
}

module.exports = { createDirectoryEnsurer, ensureBackendDirectories };
