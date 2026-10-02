const pixelmatchModule = require('pixelmatch');
const pixelmatch = /** @type {any} */ (pixelmatchModule.default || pixelmatchModule);
const { PNG } = require('pngjs');

function comparePngBuffers(expectedBuffer, actualBuffer, settings) {
    const expected = PNG.sync.read(expectedBuffer);
    const actual = PNG.sync.read(actualBuffer);
    if (expected.width !== actual.width || expected.height !== actual.height) {
        throw new Error(
            `Visual dimensions differ: expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`,
        );
    }

    const diff = new PNG({ width: expected.width, height: expected.height });
    const differentPixels = pixelmatch(
        expected.data,
        actual.data,
        diff.data,
        expected.width,
        expected.height,
        { threshold: settings.pixelThreshold },
    );
    const ratio = differentPixels / (expected.width * expected.height);
    const regionSize = settings.regionSize;
    let maxRegionDistance = 0;
    let maxRegion = { x: 0, y: 0 };

    for (let regionY = 0; regionY < expected.height; regionY += regionSize) {
        for (let regionX = 0; regionX < expected.width; regionX += regionSize) {
            let regionMax = 0;
            const endY = Math.min(expected.height, regionY + regionSize);
            const endX = Math.min(expected.width, regionX + regionSize);
            for (let y = regionY; y < endY; y++) {
                for (let x = regionX; x < endX; x++) {
                    const offset = (y * expected.width + x) * 4;
                    const dr = expected.data[offset] - actual.data[offset];
                    const dg = expected.data[offset + 1] - actual.data[offset + 1];
                    const db = expected.data[offset + 2] - actual.data[offset + 2];
                    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
                    regionMax = Math.max(regionMax, distance);
                }
            }
            if (regionMax > maxRegionDistance) {
                maxRegionDistance = regionMax;
                maxRegion = {
                    x: Math.floor(regionX / regionSize),
                    y: Math.floor(regionY / regionSize),
                };
            }
        }
    }

    return {
        width: expected.width,
        height: expected.height,
        differentPixels,
        ratio,
        maxRegionDistance,
        maxRegion,
        passed:
            ratio <= settings.maxDifferentRatio &&
            maxRegionDistance <= settings.maxRegionColorDistance,
        diffBuffer: PNG.sync.write(diff),
    };
}

module.exports = { comparePngBuffers };
