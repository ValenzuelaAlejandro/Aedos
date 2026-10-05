# Generation

Classic-script helpers for the generation flow. Modules register a narrowly scoped
factory on `window.AedosGeneration`; `app.js` supplies DOM and shared-state
dependencies at the point the behavior runs to preserve initialization order.

