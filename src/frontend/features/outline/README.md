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

`editor-bindings.js` binds slide fields and point controls. It receives a live
slide getter and render/count callbacks from `scripts/outline.js`; it mutates the
same slide objects as the legacy editor, without owning a second copy of the
outline state.
