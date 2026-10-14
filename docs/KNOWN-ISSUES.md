# Current limitations

This document describes existing behavior and verification limits.

- **Provider failure after streaming begins:** the provider-network tests
  characterize terminal SSE behavior when a Gemini stream fails midstream.
  Content already sent is not retrospectively restarted through OpenRouter.
- **Browser initialization:** `src/backend/browser/manager.js` can install
  Chrome when no executable is found. Initialization runs from the server
  bootstrap and can depend on the local cache.
- **Credit availability:** credit identity is based on IP. Redis failure
  blocks credit-backed generation and paid routing.
- **PPTX fidelity:** unsupported CSS, complex SVG/canvas, clipping, filters,
  and nested tables can use raster fallbacks. Export warnings describe these
  cases. Fonts unavailable on the destination machine may be substituted.
  See the export guides for measured fidelity and compatibility limits.
- **Verification state on 2026-10-14:** the cleanup check passed 154 of 158
  frontend/export/prompt tests and all 63 contract/queue tests. Four failures
  also reproduced on the unchanged source: CSS order, two outline renderer
  cases, and vendor asset order. The editor visual flow stopped at
  `flow-01-landing`; the same checkpoint failed before the cleanup.
- **Quality checks:** lint and type checking use committed diagnostic
  ratchets rather than requiring zero diagnostics. Their reports are written
  to `tmp/`.
