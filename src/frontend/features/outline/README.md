# Outline feature

`slide-renderer.js` builds the existing editable outline slide markup. The
application keeps event binding and outline state in `scripts/outline.js`;
this module owns only DOM item creation and preserves the legacy HTML output.
