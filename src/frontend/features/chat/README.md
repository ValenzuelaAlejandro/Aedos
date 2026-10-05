# Chat feature

Classic scripts in this folder provide chat-oriented UI services and load
before the application scripts that consume them.

`attachment-renderer.js` renders the existing file-chip markup and owns the
shared HTML escaping helper. Its `window.AedosChatRenderer.renderFileChip`
service is used by outline chat history, while `window.escapeHtml` remains as a
compatibility global for the current app and outline scripts.

`attachments.js` owns the existing upload validation, file chips, and page drag
handlers. `app.js` calls its two factories at the original listener registration
points so preview/editor drops and the legacy `_attachedFiles` bridge keep the
same behavior.

`input-controller.js` owns chat composer input, Enter-key, warm-up, character
count, and cursor bindings. Its factory is called where those listeners were
previously registered, preserving their order and the existing DOM behavior.
It also exposes `registerFillInput`; `app.js` calls it at the previous global
registration point to keep translated prompt-chip insertion available.
The suggestion-pill binder is likewise invoked at the script's original
document-level point, outside the DOMContentLoaded callback.

`loading-controller.js` owns the generate-button loading state, hero typewriter
messages, and the existing control-disable behavior. The app creates it at the
former initialization point and keeps the returned callbacks for generation.

`generate-validation.js` owns the send-button enablement and hero-title
activation. `app.js` retains its hoisted `validateGenerateButton` wrapper.
