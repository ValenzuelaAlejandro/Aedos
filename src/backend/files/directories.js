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
 * @param {{tmpDir: string, examplesDir: string, examplesFlashDir: string, examplesProDir: string, isDevelopment: boolean, ensureDirectory: Function}} options
 * @returns {void}
 */
function ensureBackendDirectories(options) {
    const {
        tmpDir,
        examplesDir,
        examplesFlashDir,
        examplesProDir,
        isDevelopment,
        ensureDirectory
    } = options;
    ensureDirectory(tmpDir, 'Temporary');
    if (isDevelopment) {
        ensureDirectory(examplesDir, 'Examples');
        ensureDirectory(examplesFlashDir, 'Examples flash');
        ensureDirectory(examplesProDir, 'Examples pro');
    }
}

module.exports = { createDirectoryEnsurer, ensureBackendDirectories };
