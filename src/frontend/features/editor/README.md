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

`slide-freeze.js` captures top-level editable bounds, normalizes individual
elements, and freezes a slide as one undoable operation. Its dependencies are
explicit callbacks and the existing per-iframe `WeakMap`.

`selection-lifecycle.js` owns selection/deselection and the associated
MutationObserver/ResizeObserver lifecycle. Selection state, UI updates, and
commands remain explicit callbacks into the editor coordinator.

`compatibility-facade.js` installs the same parent-frame `window.*` editor
hooks, including layer and arrow-move commands. The values remain live through
getter callbacks into the editor's per-iframe state.

`keyboard.js` owns the editor keydown shortcuts and its per-iframe clipboard
buffer. Selection and editing commands are passed as callbacks; the keydown
listener remains registered at the same bootstrap point.

`content-editing.js` owns the plain-text paste handler and both direct-content
and selection-box double-click text-edit lifecycles. DOM listeners are
registered in their prior order; selection, normalization, and history remain
editor callbacks.

`snap-targets.js` builds the ordered slide-edge, padding, and peer alignment
targets used during drag and resize. It reads geometry from the supplied slide
and editable-element callback and retains no mutable state.

`resize-interaction.js` applies the existing pointer resize delta, collision
minimums, snapping guides, and inline styles using the start state supplied by
the editor. `drag-interaction.js` applies the matching drag collision, guide,
and position updates. Neither module owns pointer state.

Add an editor-only shared service here when it can be moved without changing the
iframe API, DOM, styles, timers, or event order. Add a focused test under
`tests/` and include it in `verify:baseline` before extracting the old block.

`resize-interaction.js` applies the iframe editor's pointer resize delta,
minimum-size collision handling, snapping guides, and inline styles using the
existing start state supplied by the editor.

`color-picker.js` provides the same theme-aware swatch palette, visibility
toggle, and color application callbacks for editor text and fills.

`element-operations.js` owns grouped element deletion and duplication. It
receives the existing group, history, normalization, freeze, and selection APIs.

`grouping.js` computes the existing visually-contained child set and slide-
relative starting coordinates from the editor's supplied semantic predicate.

`selection-dom.js` creates the existing selection box, resize handles, toolbar,
and alignment guide elements, and attaches them to the document root on demand.

`slide-observers.js` installs the legacy navigation events and mutation
observers that clear editor selection when the active slide changes.

`toolbar-markup.js` renders the existing text, image, and shape toolbar branches
from the selected element's semantic predicates and palette.
