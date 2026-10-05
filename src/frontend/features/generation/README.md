# Generation

Classic-script helpers for the generation flow. Modules register a narrowly scoped
factory on `window.AedosGeneration`; `app.js` supplies DOM and shared-state
dependencies at the point the behavior runs to preserve initialization order.

`preview-transition.js` owns the guarded chat-to-preview handoff, preserving
the original animation classes, double-frame layout pass, and 380/300 ms timers.

`proceed-flow.js` owns the outline-approved progress message, its 2.5-second
interval, and the existing final-generation handoff using the live window state.

`skeleton-error-presenter.js` owns cleanup and chat/error-modal presentation for
failed skeleton requests, receiving the same generation state and UI callbacks.
