# Editor feature modules

Classic-script modules used by the presentation iframe editor. They load before
`/editor/editor.js` in generated HTML. The editor entrypoint is a native ES
module and imports these leaf modules directly; its `window.*` application
compatibility hooks remain owned by the editor bootstrap.

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

Add an editor-only shared service here when it can be moved without changing the
iframe API, DOM, styles, timers, or event order. Add a focused test under
`tests/` and include it in `verify:baseline` before extracting the old block.
