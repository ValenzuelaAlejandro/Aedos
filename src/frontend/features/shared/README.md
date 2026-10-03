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
