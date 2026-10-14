# Contributing to Aedos

## Repository language

Write project documentation, README files, code comments, and new internal code identifiers in English. Keep user-facing translations in their supported languages. Preserve existing API field names, translation keys, fixture payloads, and other compatibility contracts when editing documentation.

## Runtime

Aedos requires Node.js `>=22.8.0`. Tests share state across files with
`--experimental-test-isolation=none` (the Node 22 name, retained as an alias
in Node 24). `.nvmrc` selects the 22 release line; CI checks 22.x and 24.x
and tests flag compatibility before running the suite.

## Checks

- `npm run test:safe`: unit tests without Windows process isolation.
- `npm test`: the original Node command; on Linux it should run without the
  Windows `spawn EPERM` restriction.
- `npm run test:contract`: HTTP and multipart contracts.
- `npm run test:rate-limit-evaluators` and `npm run test:prompts-modules`:
  pure rate-limit and prompt-module characterization.
- `npm run check:dom`: static ID references.
- `npm run verify:quality`: lint, type checking, and formatting ratchets.
- `npm run verify:baseline`: the existing functional and visual safety net.
- `npm run check:baseline:visual`: compares six screenshots with external
  networking blocked, animations disabled, and test providers.
- `npm run check:baseline:mutations`: confirms that real visual changes are
  detected while a CSS comment and an obscured change do not cause failures.
- `npm run verify:all`: both verification groups.
- `npm run baseline:export`: manually regenerates the committed PPTX manifest,
  writing `tests/baseline/exports/manifest.json`.
- `npm run check:baseline:export`: generates packages and a manifest in a
  temporary directory and compares them with the committed baseline without
  writing to `tests/`. Exact XML comparison runs on Windows because geometry
  measured by Chromium varies with fonts and platform.

If a ratchet fails, inspect its report in `tmp/`, determine whether the change
is intentional, and update the corresponding baseline only after reviewing
the diff. Explicit regeneration commands are
`node scripts/lint-ratchet.js --write` and
`node scripts/typecheck-ratchet.js --write`.

If a total decreases, preserve the reduction and lower the baseline in a
separate commit from the code change; run `npm run verify:all` after that
commit too. Do not lower ratchets to hide new diagnostics. Refactoring size
measurements must come from the committed blob
(`git show <commit>:<file> | wc -l`), not a working tree count.

## Visual baseline

Regenerate screenshots only when an intentional, reviewed change alters a
user-visible view: structure, styling, layout, or UI state. Do not regenerate
a baseline to make an unexplained difference pass.

1. Run `npm run baseline:visual`. Puppeteer captures desktop light/dark,
   mobile, the error modal, editable outline, and presentation iframe preview.
   The runner blocks external requests, disables animations, and uses the test
   provider seam; it needs neither credentials nor provider calls.
2. Review each new or changed PNG in `tests/baseline/screenshots/` and its Git
   diff. Keep unaffected views unchanged.
3. Run `npm run check:baseline:visual`,
   `npm run check:baseline:mutations`, and `npm run verify:all`.

Comparison uses a pixelmatch threshold of `0.03`, at most `0.01%` different
pixels, and a second metric: maximum Euclidean RGB distance of 20 per 32×32
tile. `tests/baseline/visual-config.json` has no masks; keep the list empty
unless a genuinely dynamic region has a documented reason and a minimal
rectangle. The local debug-button endpoint is fixed at 404 and animations are
neutralized so those states do not add screenshot noise.

The background-mutation diagnosis is in
[`docs/visual-baseline-diagnosis/README.md`](docs/visual-baseline-diagnosis/README.md).

Follow the guideline of one file per responsibility and aim to stay below
400 lines per file. This is reported as a warning so improvements can happen
gradually without blocking refactoring.

For new backend modules, the closeout guide calls for one responsibility,
JSDoc/typedefs, a folder README where applicable, and a 300-line target.
Do not split prompt literals/templates or PPTX serializers without proving
exact equivalence and preserving observable order.
