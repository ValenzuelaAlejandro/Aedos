const assert = require('node:assert/strict');
const specs = require('./mutation-specs');
const { startRuntime } = require('./runtime');
const { runProbe } = require('./mutation-probes');

/** @typedef {import('./mutation-specs').MutationSpec} MutationSpec */

async function run() {
    const runtime = await startRuntime();
    try {
        for (const spec of specs) {
            console.log(`Checking mutation sentinel: ${spec.name}`);
            const baseline = await runProbe(runtime, {}, spec.probe, `control-${spec.name}`);
            assert.deepEqual(baseline, spec.expected, `${spec.name}: unmutated contract control failed`);
            const mutant = await runProbe(runtime, { [spec.file]: spec.edits }, spec.probe, `mutant-${spec.name}`);
            assert.notDeepEqual(mutant, spec.expected, `${spec.name}: mutation escaped its contract assertion`);
            console.log(`Mutation detected: ${spec.name} (${JSON.stringify(mutant)} != ${JSON.stringify(spec.expected)})`);
        }
        console.log(`Editor safety mutation sentinels: ${specs.length}/${specs.length} detected.`);
    } finally {
        await runtime.close();
    }
}

if (require.main === module) {
    run().then(() => process.exit(0)).catch((error) => {
        console.error(error.stack || error);
        process.exit(1);
    });
}
