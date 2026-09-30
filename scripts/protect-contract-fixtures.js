const fs = require('node:fs');
const path = require('node:path');

const fixtureDir = path.resolve(__dirname, '..', 'tests', 'fixtures', 'contracts');
const originalMkdirSync = fs.mkdirSync;
const originalReadFileSync = fs.readFileSync;
const originalWriteFileSync = fs.writeFileSync;

function isProtectedPath(file) {
    const resolved = path.resolve(String(file));
    return resolved === fixtureDir || resolved.startsWith(`${fixtureDir}${path.sep}`);
}

fs.mkdirSync = function (directory, options) {
    if (path.resolve(String(directory)) === fixtureDir && fs.existsSync(fixtureDir))
        return undefined;
    return originalMkdirSync.call(this, directory, options);
};

fs.writeFileSync = function (file, data, options) {
    if (!isProtectedPath(file)) return originalWriteFileSync.call(this, file, data, options);

    const expected = originalReadFileSync.call(this, file);
    const actual = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    if (!actual.equals(expected))
        throw new Error(`Contract fixture differs: ${path.relative(fixtureDir, String(file))}`);
};
