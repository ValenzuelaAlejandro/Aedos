# Editor feature modules

Classic-script modules used by the presentation iframe editor. They load before
`/editor/editor.js` in generated HTML so the iframe retains its existing global
compatibility API and synchronous initialization order.

## Semantic targeting

`semantics.js` owns the legacy selectors and predicates used to decide which
presentation nodes are text, image slots, visual leaves, semantic containers,
or ignored editor chrome. `window.AedosEditorSemantics` is an internal
iframe-only factory bridge; `window.editableSelectors` remains assigned by the
editor bootstrap at its original initialization point.

## History

`history.js` owns the private undo/redo stack, clean HTML snapshots, the 50-entry
cap, duplicate suppression, and `state-restored` notifications. The editor
bootstrap supplies the restoring flag and selection/UI lifecycle callbacks.
Its `window.AedosEditorHistory` factory is an internal iframe-only bridge, not a
public application contract.
Keep its timer (50 ms), initial snapshot delay (500 ms), event name, and payload
unchanged unless a separately approved behavior change is tested.

Add an editor-only shared service here when it can be moved without changing the
iframe API, DOM, styles, timers, or event order. Add a focused test under
`tests/` and include it in `verify:baseline` before extracting the old block.
