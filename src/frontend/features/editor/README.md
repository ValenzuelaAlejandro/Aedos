# Editor feature modules

Native ESM modules used by the presentation iframe editor. The `/editor/editor.js`
entrypoint imports these leaf modules directly. Its `window.*` application
compatibility hooks remain owned by the editor bootstrap. `selection-geometry.js`
and `semantics.js` are currently included in the frontend `checkJs` scope; extend
that scope only as additional modules pass typecheck without increasing its
diagnostic ratchet.

## Semantic targeting

`semantics.js` owns the legacy selectors and predicates used to decide which
presentation nodes are text, image slots, visual leaves, semantic containers,
or ignored editor chrome. `createAedosEditorSemantics` is a module export,
consumed only by `editor.js`. `window.editableSelectors` remains assigned by
the editor bootstrap because the parent tools panel reads it from the iframe.

## History

`history.js` owns the private undo/redo stack, clean HTML snapshots, the 50-entry
cap, duplicate suppression, and `state-restored` notifications. The editor
bootstrap supplies the restoring flag and selection/UI lifecycle callbacks.
`createEditorHistory` is a module export consumed only by `editor.js`.
Keep its timer (50 ms), initial snapshot delay (500 ms), event name, and payload
unchanged unless a separately approved behavior change is tested.

## Selection geometry

`selection-geometry.js` calculates the viewport-clipped selection box and the
existing toolbar edge fallbacks as a pure helper. It is loaded before
`editor.js`; it is imported as a module, not exposed on `window`. The helper
deliberately preserves the legacy 340px fallback
toolbar width, 50px small-selection threshold, and 10/12px viewport margins.

`collision-geometry.js` owns the pure drag position and resize minimum-size
calculations used by the iframe editor. It accepts the original element and
slide arguments for API compatibility and retains no editor state.

`targeting.js` owns editable-element traversal, event-target resolution, and
stable drag-target selection. Its factory receives the iframe document,
constructors, and the shared semantic predicates explicitly; it retains no
mutable editor state.

`style-snapshot.js` captures the typography fields copied during element
normalization. It receives the iframe's computed-style function and stores no
state.

`selection-ui.js` positions the selection rectangle and floating toolbar from
the current selection, viewport, and drag/resize state supplied by the editor.

Add an editor-only shared service here when it can be moved without changing the
iframe API, DOM, styles, timers, or event order. Add a focused test under
`tests/` and include it in `verify:baseline` before extracting the old block.
