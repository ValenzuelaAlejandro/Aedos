# Outline feature

`slide-renderer.js` is a native module that imports the shared HTML escaping
helper from the chat feature and builds the existing editable outline slide
markup. The application keeps event binding and outline state in
`scripts/outline.js`; this module owns only DOM item creation and preserves the
legacy HTML output. Its `window.AedosOutlineRenderer` facade remains for that
classic controller until it is migrated.
