# Aedos contracts

This document records the public and browser-facing contracts observed during
the Phase 0 safety work. It is descriptive and does not replace the endpoint
implementation or the generated HTML model.

## HTTP endpoints

- `GET /health`: health check, expected HTTP 200.
- `GET /`: frontend entry point.
- `POST /generate-skeleton`: JSON or multipart outline generation, streamed as SSE.
- `POST /generate-outline-item`: JSON single-slide/single-point generation.
- `POST /generate`: JSON or multipart final HTML generation, streamed as SSE.
- `POST /finalize`: JSON `{ html, title? }`, returns `{ pdfUrl }`.
- `POST /finalize-pptx`: JSON `{ html, title? }`, returns `{ pptxUrl }`.
- `GET /download/:filename`: downloads a temporary generated file.
- `GET /__dev__/last-generated`: development-only generated HTML inspection.

Error response bodies are cataloged in `src/backend/contracts/errors.js`. The
frontend consumes `QUEUE_FULL` and `PRO_TEMPORARILY_PAUSED` with
`retryAfterSec`, displays `Validation failed.fields` for form errors, and
consumes SSE `{ error }` events during generation. Download errors remain the
plain-text `Invalid file` and `File not found` responses.

Multipart upload validation returns JSON `{ "error": "..." }`: an upload
larger than 10 MiB returns HTTP 413; exceeding the three-file limit, using an
unsupported extension, or omitting the extension returns HTTP 400. The
frontend's generation handlers check `response.ok`, parse the JSON body, and
display its `error` string (falling back to `Server error: <status>`). They do
not branch on 400 versus 413 or show a dedicated upload-error state; file size
and count are also checked client-side before submission.

## Generation inputs

Important fields are `tema`, `mode`, `slides`, `language`, legacy `idioma`,
`skeleton`, and optional `files`. Topics are limited to 600 characters;
uploads allow PDF, DOC/DOCX, PNG, JPG/JPEG and WEBP, with the implementation's
file-count and byte limits.

Limits and environment defaults live in `src/backend/contracts/limits.js` and
`src/backend/contracts/config-defaults.js`. Request normalizers are integrated
in the generation routes; their 50 HTTP characterization cases freeze status
and response-body behavior.

## SSE event shapes

Generation streams use `data: <JSON>\\n\\n`. Observed event keys include
`queued`, `reasoning`, `stage`, `chunk`, `metadata`, `heartbeat`, `done`,
`skeleton`, `html`, and `error`. Client code also interprets retry messages in
the form `ERROR|RETRY_AFTER=<seconds>`.

## DOM and globals

The static DOM is defined in `src/frontend/index.html`; JavaScript accesses it
with `getElementById` and CSS selectors. Run `npm run check:dom` to validate the
static ID references. Dynamically generated slide/iframe IDs are intentionally
not treated as static page IDs.

The frontend exposes a compatibility API on `window`, including outline state,
i18n functions, editor/tool/minimap initializers, thinking-panel API, and
outline actions. These names must remain stable until their consumers migrate.

### Window inventory

| Defined by | Properties defined | Main consumers |
|---|---|---|
| `features/shared/i18n.js` | `currentLang`, `__t`, `__applyTranslations` | all UI scripts, `index.html` data attributes |
| `features/shared/http-sse.js` | `AedosHttpSse` temporary facade; named module exports `openResponse`, `readReader` | classic `app.js` and `outline.js` stream consumers |
| `features/shared/init.js` | fallback `__t`, `currentLang` | shared navigation |
| `features/tools/shape-inserter.js` | `AedosEditorInsertions` | `tools.js` only (internal editor-tools factory bridge; not a public application API) |
| `mobile/js/nav-dots.js` | `AedosMobileNavDots` | `mobile/js/bridge.js` only (internal mobile factory bridge; not a public application API) |
| `features/minimap/minimap-view.js` | `AedosMinimapView` | `minimap.js` only (internal page factory bridge; not a public application API) |
| `features/minimap/minimap.js` | `initMinimap`, `syncMinimapActiveState` | `app.js`, editor lifecycle |
| `features/tools/tools.js` | `initTools`, `_addImageHandler` | `app.js`, iframe bridge |
| `features/chat/thinking-panel.js` | `AedosThinking` | `app.js`, `outline.js` |
| `editor/editor-ui.js` | `initEditorUI`, `_minimapInterval`, `_keydownHandler` | `app.js` |
| `editor/editor.js` | editor selection, undo/redo, layer and movement helpers; `editableSelectors` | `app.js`, `tools.js`, mobile bridge (`tools.js` reads `iframe.contentWindow.editableSelectors`) |
| `outline.js` | `outlineEditorState`, outline parsing/rendering/editing functions | `app.js`, outline DOM |
| `app.js` | navigation, generation, preview, export, zoom and slot-overlay helpers | `index.html`, mobile bridge, editor/tools |
| `mobile/js/config.js` | `MobileConfig` | mobile runtime |
| `mobile/js/app-mobile.js` | `MobileRuntime`, `_mobile_zoom`, `_pan` | mobile bridge |
| `mobile/js/bridge.js` | touch/drawer helpers | mobile controls and editor |

The remaining underscore-prefixed properties are transient state, timers or
event-handler references: `_attachedFiles`, `_activeGenController`,
`_pendingGenerateBodyData`, `_pendingGenerateHeaders`, `_chipsRenderTimeout`,
`_heroTypewriterTimer`, `_heroResetTimer`, `_btnMsgTimer`,
`_proceedMsgInterval`, `_restoreBatchT`, `_manualZoomScale`, `_baseScale`,
`_slotMsgHandler`, `_ensureInternalOverlay`, `_triggerImagePicker`,
`_pruneDeadSlotOverlays`, `_refreshSlotOverlays`, `_buildOverlayForSlot`,
`_editorInitialized`, `_mobileBridgeLegacyLoaded` and `_backupSkeleton`.

### Dynamic iframe controls

These are created inside generated presentation/editor markup and must not be
checked against the static `index.html` DOM:

- `editor.js`: `#editor-btn-size-down`, `#editor-btn-size-up`,
  `#editor-btn-text-color`, `#editor-btn-bg-color`, `#editor-btn-delete`,
  `#editor-btn-duplicate`, `#editor-btn-replace-img`,
  `#editor-tb-size-val`, `#editor-color-picker`.
- `tools.js`: `#tool-bg-color`, `#tool-add-slide-alt`, `#lib-back-btn`,
  `#tool-font-size`, `#tool-font-add`, `#tool-font-min`, `#tool-bold`,
  `#tool-italic`, `#tool-under`, `#tool-color`, `#tool-align-l`,
  `#tool-align-c`, `#tool-align-r`, `#tool-font-picker`,
  `#tool-font-trigger`, `#tool-font-dropdown`, `#tool-font-label`,
  `#tool-replace-img`, `#tool-radius`, `#tool-opacity`, `#tool-fill`,
  `#tool-stroke`, `#tool-icon-size`, `#tool-layer-up`, `#tool-layer-down`,
  `#tool-delete`.
- `skeleton-injector.js`/`app.js`: `#temp-skeleton`, created in generated HTML.

The checker allowlists this generated set and still validates static page IDs.

### Phase 0c editor safety contracts

`npm run check:editor-safety` freezes the UI state reached by the deterministic
browser flow in `scripts/editor-safety/`. Its static IDs include the IDs listed
in that test's `requiredIds` array; the exercised compatibility globals include
`outlineEditorState`, `parsePartialSkeleton`, `renderStreamingOutline`,
`finalizeStreamingOutline`, `initOutlineEditor`, `deleteSlide`, `moveSlideUp`,
`moveSlideDown`, `proceedWithCurrentOutline`, `startFinalGeneration`,
`initTools`, `initMinimap`, `editorSelect`, `editorGetSelection`, `editorUndo`,
`editorRedo`, and `toFront`. Their names and the event order are checked by
browser assertions, not inferred from screenshot pixels alone.

The fixtures answer `/generate-skeleton` and `/generate` with exactly two SSE
events each, in order: `chunk`, then `done`. The browser request trace must be
`/generate-skeleton`, `/generate`, `/finalize`, `/finalize-pptx`; the first
request must carry the selected Japanese UI language (`idioma: "ja"` or its
serialized equivalent). PDF and PPTX results are fixed mock responses. All
external browser requests are aborted and no provider is contacted.

The new `tests/baseline/editor-safety/` captures exist because Phase 0c adds
visual checkpoints after each tested state; they do not replace or regenerate
the six general visual captures. Capture animation/transition APIs are disabled
in the test harness, and the mock HTML makes editor geometry deterministic.
Regenerate only with `npm run baseline:editor-safety`, then review every changed
image and run `npm run check:editor-safety`.

#### NO cubierto

- The legacy “Add Section” control is under `.outline-bubble-footer`, which the
  current stylesheet hides. The flow clicks its bound button programmatically;
  it verifies the action/state but does not claim pointer-visible coverage of
  that control.
- Outline add/delete/reorder in this safety flow exercises the existing bound
  action and `window.deleteSlide`/`window.moveSlideUp`/`window.moveSlideDown`
  APIs. Pointer drag-and-drop reordering is not covered.
- Theme toggle is captured in chat. The theme button is hidden in preview, so
  theme switching while the iframe editor is active is not covered.
- Provider latency, queue waiting, provider failure mid-stream/fallback,
  browser/network conditions outside loopback, and real PDF/PPTX rendering are
  not covered by this mocked browser flow. The export endpoints return fixed
  payloads; structural export baselines remain separate.
- Desktop preview zoom is exercised only in its normal non-fullscreen range
  (100% to 90% and back); fullscreen zoom behavior is not covered here.
- The minimap's initial active-thumbnail highlight is timing-sensitive during
  the 800 ms thumbnail refresh after iframe mutations. The zoom-reset capture
  deliberately excludes the minimap; its thumbnail rendering in that
  intermediate state is `NO cubierto`. Dedicated minimap checkpoints click the
  first and second thumbnails, wait for the refresh, and assert the selected
  slide index and active marker. Before screenshotting a ready preview, the
  harness waits for every minimap iframe document and its fonts to finish
  loading; it does not await animation-frame promises inside replaceable
  thumbnails.

The outline-add checkpoint waits until the two expected suggested chips have
rendered before capture. This prevents a valid delayed chip-rendering state
from making the same checkpoint differ depending on when the screenshot starts.

## Sanitization snapshots and security findings

Snapshots live in `tests/fixtures/sanitization/` and are tested by
`npm run test:sanitization`. They include scripts, event handlers, JavaScript
URLs, data URLs, embedded elements, CSS imports/URLs, SVG scripts, conditional
comments, malformed HTML, entities, mixed case and representative Flash/Pro
examples.

The sanitizer was hardened in `42987ac` for the explicitly listed active-content
vectors: scripts, inline handlers, `iframe`/`object`/`embed`, unsafe imports,
`javascript:`/`data:text/html` URLs, and dangerous CSS declarations. The
adversarial fixture expectations are the contract; representative safe Flash
and Pro output hashes, Google Fonts, and `data:image/*` remain preserved. This
is a bounded policy, not a general HTML allow-list; unlisted constructs still
need a separate reviewed security task.

## Script load order

`index.html` loads the shared catalog and i18n before feature code; editor/tool/
mobile bridges load before `app.js` and `outline.js`. ESM is used for selected
layers, but classic scripts and documented `window.*` bridges remain part of the
compatibility contract.

## Timers and watchdogs

The current timer inventory is intentionally recorded here because these are
observable timing surfaces during the refactor: `app.js` owns the 600000 ms SSE
watchdog, 250 ms progress polling, 28 ms typewriter, 50/300/500/800 ms preview
and editor setup timers, 100/400/500/1500 ms overlay timers, and the 100 ms
retry; `outline.js` owns chip rendering/debounce and 400/500 ms entry effects;
`editor-ui.js` owns `_minimapInterval`; `tools.js` owns selection debounce and
1000 ms undo flags; `minimap.js` owns update debounce and 50/200/300 ms layout
timers; `thinking-panel.js` owns reasoning intervals and its no-reasoning
timeout; and `mobile/js/bridge.js` owns the 1200 ms dot-sync interval. These
watchdogs and timers remain frozen until a later phase characterizes them with
dedicated timing tests.

## Baseline verification

The current Phase 0 baseline is stored under `tests/baseline/`. Visual checks
use exact SHA-256 hashes when stable; responsive captures allow a maximum 15%
file-size drift and report that fallback explicitly. PPTX checks compare the
ZIP part list and normalized slide XML hashes without hashing the ZIP container
timestamps. PDF checks compare URL shape, content type/signature, page count,
dimensions, and byte count in `tests/baseline/exports/pdf-manifest.json`.

## Valores duplicados en el frontend

The frontend currently repeats presentation limits independently: the SSE
watchdog is 600000 ms in `src/frontend/scripts/app.js`; Flash/Pro slide limits
are enforced in the generation UI and outline controls; attachment count and
file-size affordances are also client-side. They remain unchanged because
changing them would be observable behavior.

The isolated pressure test characterizes `503 PRO_TEMPORARILY_PAUSED` with the
existing local provider stub. The `429 QUEUE_FULL` route is documented by the
error catalog, but a deterministic concurrent queue fixture would require a
stable blocking seam. Mid-stream provider failure and Gemini-to-OpenRouter
fallback likewise require provider-failure injection; these seams are
intentionally deferred to Phase 3 rather than changing production behavior.

## Frontend compatibility APIs during Etapa 8

`src/frontend/features/shared/content-utils.js` loads as a classic script before
`scripts/app.js`. `window.AedosContentUtils.sanitizeModelOutput(value)` and
`gifToStaticDataUrl(file)` are the named service; the historical
`window.sanitizeModelOutput` and `window.gifToStaticDataUrl` aliases remain.
Model chunks still pass through the same sanitizer, and image consumers retain
the same GIF first-frame conversion behavior.

`window.AedosAppTooltips.initialize()` is called from the former tooltip
registration point in `app.js`. It registers the delegated `mouseover`,
`mouseout`, `mousedown`, and capture-phase `scroll` listeners in that order.
`src/frontend/features/editor/toolbar-{size,action,swatch}-events.js` and
`font-size-actions.js` own only their specified controls; event selector order,
callbacks, and legacy editor globals remain unchanged. These are transitional
APIs, not authorization to remove existing `window.*` compatibility names.

## Snapshot de refactor frontend 8e (2026-10-04)

No se cambiaron endpoints, payloads, eventos SSE, markup visible ni nombres
`window.*` en esta continuación. `features/editor/snap-guide-calculation.js`
recibe arrays y tolerancia y devuelve `{ value, delta }`; es interno al módulo
del iframe, no un contrato de aplicación. Preserva la búsqueda previa: distancia
estrictamente menor que la tolerancia, iteración candidato/target en el orden
original y primer resultado en empates. El primer intento tuvo que adaptarse a
los loaders VM; el commit final `bb44e47` y su gate pasan. Los cortes restantes
de `app.js` y la orquestación de puntero siguen pendientes; esto no declara
completada la modularización de Etapa 8.
