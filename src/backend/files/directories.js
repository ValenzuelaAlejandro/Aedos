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

module.exports = { ensureBackendDirectories };
