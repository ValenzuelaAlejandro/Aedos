# Chat feature

The native module in this folder provides chat-oriented UI rendering services.

`attachment-renderer.js` renders the existing file-chip markup and owns the
shared HTML escaping helper. It exports `renderFileChip` and `escapeHtml`; the
outline slide renderer imports the latter. The `window.AedosChatRenderer` and
`window.escapeHtml` compatibility globals remain for the classic app and outline
controllers until those consumers migrate.
