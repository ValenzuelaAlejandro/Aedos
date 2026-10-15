# Dead code cleanup — 2026-10-14

## Criteria and evidence

JavaScript in `src` was checked with ESLint, including an ESM pass using
`sourceType: module`. Candidates were checked against references in code,
HTML, tests, and scripts, and their consumers were inspected.
These reasons were communicated before deleting the code.

| File | Removal and justification |
| --- | --- |
| `src/backend/server.js` | Unread `http`/`https` imports, `imageLog`, and `buildLegacyPrompt`/`tryModelsFlashThinking` bindings. Prompt/provider modules remain loaded. |
| `src/backend/prompts/pipeline.js` | Unused `buildLegacyPrompt` import/reexport. Its only importer was the unread server binding; the server still uses `base.js` directly. |
| `src/backend/providers/runtime.js` | Unused `tryModelsFlashThinking` wrapper. Its only external reference was the unread server binding; active Flash callers and other stage wrappers remain. |
| `src/backend/utils/pptx-export.js` | `legacyParagraphs` and four helper variables built discarded XML. `txBody` uses `paragraphsModel` → `paragraphXml`, including the plain-text fallback. |
| `src/frontend/scripts/app.js` | Unread `downloadBtn`/`resultSubtitle` DOM bindings; HTML elements and export handlers remain. |
| `src/frontend/editor/editor.js` | Unread `resolveResizeCollision` import and nine destructured bindings: `handleEls`, `getDynamicPalette`, `showColorPicker`, `ignoreSelectors`, `getSlideRoot`, `isIgnoredElement`, `isVisualLeafElement`, `isEditableElement`, `getEditableElementsInNode`. Factories and shared implementations remain. |
| `src/frontend/features/editor/selection-lifecycle.js` | Unread `slide` lookup in ResizeObserver; it contributed neither height nor position calculations. |
| `src/frontend/features/editor/toolbar-swatch-events.js` | SVG lookup whose result was unused; color application and change notification remain. |
| `src/frontend/mobile/js/app-mobile.js` | Private `blurFocusedTextControl` had no calls and was not exposed through `MobileRuntime`. |
| `src/frontend/mobile/js/bridge.js` | Residual long-press/touch-to-mouse code. No timer was scheduled, `longpress-drag` was never assigned, and no caller sent the `mousedown` needed to create `dragTarget`. Discarded coordinates and self-updating, unread `panState.moved` were removed. Zoom, pan, swipe, and listeners remain. |
| `src/frontend/mobile/js/config.js` | `longPressMs` was consumed only by the unread bridge constant. |

`src/frontend/mobile/mobile-bridge.js` remains as a public legacy entry point.
No internal references does not prove that external pages never load it.
The review does not establish absolute absence of dead CSS or dynamically used APIs.

## Verification

- Frontend, PowerPoint, and prompt suite: **154/158 pass**. Four failures
  reproduced on unchanged source in a temporary folder: CSS order, two outline
  renderer cases, and vendor asset order.
- `npm run test:contract`: **62/62 pass**, plus **1/1** queue test.
- `npm run verify:quality`: lint, types, and format pass their existing
  ratchets, with 43 lint warnings and 16 accepted type diagnostics.
- Additional ESM-aware ESLint pass on `src`: no `no-unused-vars`,
  `no-unreachable`, or parsing errors.
- `npm run check:dom`: passes for 155 static IDs.
- Temporary VM comparison: nine scenarios have identical observable traces
  before/after (tap, both swipe directions, vertical movement, cancellation,
  multitouch, pinch then pan, pinch cancellation, and desktop viewport).
  This does not replace physical-device testing.
- `npm run check:editor-safety`: stops at visual checkpoint
  `flow-01-landing`; unchanged source reproduces the failure. Remaining
  flow/mutation checks did not execute.
- `git diff --check`: no whitespace errors.

Auxiliary scripts/logs are in Git-ignored `tmp/`. Baselines were not updated
to hide failures. Cleanup code was pushed in `39f75eb`; this report remains
local and was excluded from that commit and push.
