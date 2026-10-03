# Editor safety browser contracts

This folder contains the deterministic, browser-level regression harness for the
editor, outline, and export flows. It talks only to an ephemeral loopback server;
generation and export endpoints are intercepted and answered with fixed fixtures.
External browser requests are aborted, providers are never contacted, and motion
is disabled in the test page.

Run `npm run baseline:editor-safety` only when adding a new named editor state or
after an intentional UI change has been visually reviewed and accepted. It
writes only `tests/baseline/editor-safety/`; it does not refresh the general
visual baseline. Regeneration is justified in Phase 0c because the new flow
adds per-step captures for outline editing, editor operations, export, and error
states that the earlier six-capture suite did not contain. Review the image diff,
then run `npm run check:editor-safety` before committing. Normal CI and
`npm run verify:all` compare every checkpoint and run behavioral contracts and
mutation sentinels against the committed images. Each checkpoint has a DOM/state
assertion before capture.

The DOM IDs, global bridges, and mocked SSE order in these tests are compatibility
contracts. Any editor state that cannot be reached deterministically without a
real provider or an external service is listed as `NO cubierto` in
`docs/CONTRACTS.md`.

The harness waits for iframe documents and fonts to be ready before visual
capture. The outline-add checkpoint also waits for its suggested chips to be
rendered. These waits characterize stable visible states; they do not extend or
patch production timers.
