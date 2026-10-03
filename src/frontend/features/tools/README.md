# Editor tools

Classic-script helpers for the presentation editor's tools panel.

`shape-inserter.js` owns insertion of the existing CSS shape and Lucide icon
elements. It receives the active iframe document, editor window, and active
slide resolver from `tools.js`; it keeps the same style defaults, history save,
selection fallback, and selection refresh behavior. Its
`window.AedosEditorInsertions` factory is an internal bootstrap bridge, not a
public app API.
