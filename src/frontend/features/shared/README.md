# Shared browser utilities

Classic scripts in this folder load before feature scripts from `index.html`.
Keep each file focused on one cross-feature browser service and preserve its
documented `window.*` API until consumers are migrated in a later phase.

`http-sse.js` owns framing and incremental UTF-8 decoding for HTTP response
streams. `window.AedosHttpSse.openResponse(response, options)` returns the
underlying reader (so existing watchdog cancellation remains possible) and an
async iterable of `{data, tail}` records. The `line` framing and `event`
framing intentionally preserve the two established frontend readers' distinct
whitespace, delimiter, and final-tail behavior. `tail: true` marks the
presentation reader's special EOF path. Event interpretation stays in
the requesting feature. Equivalence vectors are in
`tests/fixtures/frontend/sse/reader-cases.json`.

`outline-store.js` owns the mutable outline state. Its `window.AedosStores.outline`
API exposes `getState()`, `replaceState()` and `clearDraft()`. The writable
`window.outlineEditorState` property remains as a compatibility facade, so
existing classic scripts keep observing the same state object.

`generation-store.js` owns generation controllers, mode and language settings,
export selection, sequence/preview identity, and request handoff fields. The
legacy writable `window._activeGenController`, `window._attachedFiles`,
`window._backupSkeleton`, `window._pendingGenerateBodyData`, and
`window._pendingGenerateHeaders` properties are accessors into that state, so
existing classic scripts and inline consumers keep the same observable values.

`preview-editor-store.js` owns the preview document, markup, title, slide
container/cursor/count, and editor inset animation state. Its
`window.currentSlide` facade is deliberately a separate mirrored value: the
legacy app synchronized it only at initialization, preview reset, and slide
navigation, so it is not a live alias of the private cursor.
