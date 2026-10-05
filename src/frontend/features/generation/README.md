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

`approved-outline-proceed.js` owns the existing explicit outline-approval
shortcut, pending request payload, and progress-message timer lifecycle while
`app.js` keeps `window.proceedWithCurrentOutline` as its compatibility wrapper.

`stage-progress.js` owns pipeline retry/stage text and the original status,
hero, and button animations for final-generation SSE events.

`reasoning-progress.js` routes reasoning tokens to the latest chat thinking
panel, retaining the existing stage label and panel-creation behavior.

`skeleton-generation.js` owns the original skeleton request, SSE parsing,
outline updates, cancellation, and error handling as one vertical flow.
