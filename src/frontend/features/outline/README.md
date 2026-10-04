# Outline feature

`slide-renderer.js` builds the existing editable outline slide markup. The
application keeps event binding and outline state in `scripts/outline.js`;
this module owns only DOM item creation and preserves the legacy HTML output.

`stream-parser.js` parses complete and partially typed slide fragments from
streamed JSON. It is pure: it does not own UI state or DOM nodes. The classic
`window.parsePartialSkeleton` function in `scripts/outline.js` remains a
compatibility wrapper while existing callers migrate.

`stream-renderer.js` updates the in-progress, disabled slide fields. It receives
the target container, partial outline data and the scroll callback, and owns no
outline store state. `window.renderStreamingOutline` remains the classic
compatibility entry point.

`editor-bindings.js` owns outline input and dropdown listeners. It receives
explicit callbacks for the live slides, slide re-render and count update, and
does not retain shared editor state. `scripts/outline.js` keeps binding
orchestration and the existing event order.

`slide-commands.js` owns blank-slide/point insertion, slide deletion and
reordering. Each command receives callbacks for the current slides, slide limit
and existing renderer; it does not retain the shared outline store. The legacy
global command functions remain wrappers in `scripts/outline.js`.

`loading-view.js` owns the existing loading/chat transition and attachment
presentation. It receives the outline store, attachment accessors and DOM
orchestration callbacks explicitly; `window.showOutlineEditorLoading` remains
the compatibility wrapper.

`loading-legacy-bridge.js` adapts the explicit loading dependencies to the
window-shaped object expected by the preserved legacy loading implementation.
It is a call-scoped adapter and retains no shared state.

`drawer-controls.js` owns outline option dropdowns and drawer/backdrop controls.
It registers listeners only when called by the existing outline bootstrap and
receives state, navigation, translation and generation-cancellation callbacks.

`container-ui.js` owns the DOM lookup, mounting, chat scrolling, and bubble
actions for outline containers. It receives the existing state and action
callbacks explicitly; it does not retain or replace the outline store.

`stream-lifecycle.js` owns outline preparation, partial rendering dispatch,
finalization, and stop cleanup. It reads the live outline state through a
getter and receives the existing rendering and validation callbacks.

`chips-renderer.js` owns suggested-chip creation, its existing one-second delay,
and chip DOM events. Translation, generation actions and animation are supplied
by `scripts/outline.js`; `window.renderOutlineSuggestedChips` remains the
compatibility entry point.
