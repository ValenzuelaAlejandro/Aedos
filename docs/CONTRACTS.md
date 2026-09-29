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

## Generation inputs

Important fields are `tema`, `mode`, `slides`, `language`, legacy `idioma`,
`skeleton`, and optional `files`. Topics are limited to 600 characters;
uploads allow PDF, DOC/DOCX, PNG, JPG/JPEG and WEBP, with the implementation's
file-count and byte limits.

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
| `features/shared/init.js` | fallback `__t`, `currentLang` | shared navigation |
| `features/minimap/minimap.js` | `initMinimap`, `syncMinimapActiveState` | `app.js`, editor lifecycle |
| `features/tools/tools.js` | `initTools`, `_addImageHandler` | `app.js`, iframe bridge |
| `features/chat/thinking-panel.js` | `AedosThinking` | `app.js`, `outline.js` |
| `editor/editor-ui.js` | `initEditorUI`, `_minimapInterval`, `_keydownHandler` | `app.js` |
| `editor/editor.js` | editor selection, undo/redo, layer and movement helpers | `app.js`, `tools.js`, mobile bridge |
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

## Sanitization snapshots and security findings

Snapshots live in `tests/fixtures/sanitization/` and are tested by
`npm run test:sanitization`. They include scripts, event handlers, JavaScript
URLs, data URLs, embedded elements, CSS imports/URLs, SVG scripts, conditional
comments, malformed HTML, entities, mixed case and representative Flash/Pro
examples.

The current sanitizer removes `<script>` blocks, inline `on*` handlers and
some quoted `javascript:` attributes. It does not currently remove every
dangerous construct in the fixture set. In particular, the current snapshots
preserve `data:text/html`, `<iframe>`, `<object>`, `<embed>`, CSS
`url(javascript:...)`, CSS `@import`, and dangerous `style` values. These are
frozen observations, not accepted security recommendations; fixing them is
outside the no-behavior-change scope of Phase 0b.

## Script load order

Shared/i18n code loads before feature code; editor/tool/mobile bridges load
before `app.js` and `outline.js`. The order matters because the current frontend
uses classic scripts and `window` globals instead of ESM imports.

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
