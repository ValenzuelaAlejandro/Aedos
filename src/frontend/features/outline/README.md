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

`chips-renderer.js` owns suggested-chip creation, its existing one-second delay,
and chip DOM events. Translation, generation actions and animation are supplied
by `scripts/outline.js`; `window.renderOutlineSuggestedChips` remains the
compatibility entry point.
