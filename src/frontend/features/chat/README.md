# Chat feature

Classic scripts in this folder provide chat-oriented UI services and load
before the application scripts that consume them.

`attachment-renderer.js` renders the existing file-chip markup and owns the
shared HTML escaping helper. Its `window.AedosChatRenderer.renderFileChip`
service is used by outline chat history, while `window.escapeHtml` remains as a
compatibility global for the current app and outline scripts.
