# Generation

Classic-script helpers for the generation flow. Modules register a narrowly scoped
factory on `window.AedosGeneration`; `app.js` supplies DOM and shared-state
dependencies at the point the behavior runs to preserve initialization order.

`preview-transition.js` owns the guarded chat-to-preview handoff, preserving
the original animation classes, double-frame layout pass, and 380/300 ms timers.

`progress-message-listener.js` registers the iframe `message` listener at the
same point in app initialization and preserves stale-iframe filtering, slide
progress updates, minimap updates, and title rendering.
