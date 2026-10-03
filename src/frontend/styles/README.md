# Main application styles

The former `style.css` was divided mechanically at top-level rule boundaries
into cascade slices. Their concatenation is identical to the original source;
they are not independent themes or layers. Keep this order in `index.html`:

1. `foundation.css` — theme foundations and landing shell.
2. `chat.css` — chat view, conversation, and mode controls.
3. `settings.css` — settings panel and input controls.
4. `dialogs.css` — loading, result, error, and transition surfaces.
5. `preview.css` — presentation canvas and editor workspace transitions.
6. `workspace.css` — workspace panels, chat mode, and follow-up chips.

Later sheets intentionally contain overrides for earlier selectors. Do not
reorder or merge these files based on selector names alone. The CSS-order
contract test protects the contiguous link sequence; `npm run verify:all`
checks the six visual captures and the editor-safety browser flow remain
pixel-identical before a style extraction is kept.
