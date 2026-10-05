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

`targeting.js` also filters the slide's editable targets against hidden nodes,
ignored editor chrome, and the currently edited element's ancestor/descendant set.

`selection-dom.js` creates the existing selection box, resize handles, toolbar,
and alignment guide elements, and attaches them to the document root on demand.

`slide-observers.js` installs the legacy navigation events and mutation
observers that clear editor selection when the active slide changes.

`slide-freeze.js` also exposes the export-only all-slide layout freeze, which
retains the legacy window wrapper and intentionally avoids creating undo state.

`arrow-movement.js` applies the existing keyboard and compatibility-facade
arrow movement with undo grouping, collision resolution, and selection refresh.

`pointer-state.js` creates the explicit per-iframe state container for pointer
coordinates, drag/resize mode, selection, snap guides, lock status, and history
restoration. The editor bootstrap continues to own the interaction logic and
listener registration order while reading and updating these same state fields.

`pointer-interactions.js` owns the selection-box resize start and document
pointer-move bindings for drag/resize. It is invoked at the former listener
registration point; state and late editor operations are injected explicitly.

`content-bindings.js` registers the existing selection click, direct edit,
paste, and selection-box text-edit listeners in their original order. Editing,
selection, and history operations remain injected callbacks.

`body-pointer-events.js` installs the existing body mousedown listener for
editable-target selection, drag initialization, and snap-target collection.
Late selection lifecycle bindings are lazy callbacks so registering this
listener retains its original order without evaluating later `const` bindings.

`resize-start.js` captures the selected element's original resize geometry and
handle after the selection-box mousedown branch saves its history snapshot.

`pointer-normalization.js` retains the pointer movement threshold, deferred
layout normalization, abort path, and origin reset before drag/resize applies
its existing deltas.

`snap-guide-calculation.js` is the pure first-stage extraction of closest-guide
matching. Drag and resize continue rendering the same guide elements at the
same event point; the helper preserves candidate order, strict tolerance, and
first-match tie behavior.

`toolbar-markup.js` renders the existing text, image, and shape toolbar branches
from the selected element's semantic predicates and palette.

`toolbar-size-events.js` binds the two existing font-size controls when their
markup is present. It receives the font-size action explicitly and owns no
selection state.

`toolbar-action-events.js` binds text/fill color, image replacement, delete,
and duplicate controls in their prior order. Late editor state and actions are
provided as callbacks so listener registration does not eagerly read bindings
initialized later in the editor bootstrap.

`toolbar-swatch-events.js` binds the existing palette swatches and delegates
selection lookup, undo snapshot, semantic text detection, and change dispatch
to the editor through callbacks.

`mouseup-cleanup.js` owns the document mouseup listener that resets drag/resize
state, hides guides, refreshes the current selection, and clears per-mousedown
flags on editable elements. All shared state remains behind bootstrap callbacks.

`font-size-actions.js` owns the font-size increment/clamp and toolbar display
commands; selection, history, computed style, and the value element are supplied
through the existing editor document/window and callbacks.
