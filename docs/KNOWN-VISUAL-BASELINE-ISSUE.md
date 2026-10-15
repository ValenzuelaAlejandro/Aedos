# Known pending visual baseline issue

Status: **pending, known and isolated from deterministic verification**. First
observed October 14, 2026 (America/Tijuana); this checkout preserves that
finding and does not regenerate its images or thresholds.

Three visual checks remain pending and were reproduced against untouched HEAD:

- `npm run check:baseline:visual` fails on `desktop-light.png` at 5.4652% in the
  current checkout. An untouched HEAD archive fails the same image at 5.1494%.
- `npm run check:baseline:mutations` fails at case `1b body fondo rojo`: the
  current checkout reports 92.12577% changed pixels, and untouched HEAD reports
  92.0409%; the test expected the body mutation to be covered by `#chat-screen`.
- `npm run check:editor-safety` fails at `flow-01-landing`, before editor
  interaction checks. The current run differs by approximately 4.8% of pixels;
  untouched HEAD fails the same checkpoint/region at approximately 4.7%.

The harnesses report rejected CORS origins for their random local server
ports. The exact contribution of CORS, pending credits, fonts, timing and
intentional UI changes to each pixel mismatch still needs diagnosis; the full
difference is not attributed to one cause without evidence.

Evidence logs: `tmp/block1-editor-safety.log` and
`tmp/block1-original-editor-safety.log`. The untouched checkout was materialized
under `tmp/block1-head-check` without changing the working source.

No baseline PNGs or visual thresholds were regenerated to hide these failures.
`npm run verify:baseline` runs all deterministic contracts, exports and frontend
tests while leaving the three checks below in their own known-visual suite.
`npm run verify:known-visual` executes each visual check separately and accepts
only the documented exact signatures (`desktop-light.png`, case `1b body fondo
rojo`, and `flow-01-landing`). An unexpected failure still exits nonzero.
`npm run verify:all` combines deterministic tests, quality and the isolated
known-visual suite. The visual baseline remains unverified until the harnesses
are repaired. This is separate from the targeted Block 4 browser checks.

For Block 4, `scripts/verify-streaming-ui.js` captures live retry/loading states
at 390 and 1440 pixels, light and dark. Those PNGs were manually inspected,
including canvas containment, status legibility, credit skeleton/message and
composer control alignment. The harness also asserts live-before-done delivery,
partial draft/iframe removal, translated retry text, and restoration on new
content. Additional 320/360-pixel runs cover narrow-control wrapping.

Follow-up: reproduce the baseline with the correct local allowed origin and
loaded dependencies, inspect pixel differences, and repair the test setup
before deciding whether any intentional UI change warrants new baseline images.
