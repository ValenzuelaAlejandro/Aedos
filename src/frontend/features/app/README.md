# App feature modules

Classic browser modules in this folder own focused application behavior. Their
small `window.AedosApp*` APIs are initialized by `scripts/app.js` at the former
registration point; keep that timing and the shared-store ownership explicit.

`tooltips.js` owns the delegated tooltip handlers, positioning constants, and
viewport calculations. It reads the tooltip node only when `initialize()` is
called from the original application bootstrap point.

`router.js` owns `window.navigateToHome`, `navigateToChat`, `navigateToEditor`,
the popstate and beforeunload handlers, and the top-brand confirmation. Its
factory receives the live generation state and registers at the former point.

`reset-controller.js` owns the context-independent reset of chat/preview DOM,
preview state, overlays, and progress display. Its factory receives the existing
state object and clear/start callbacks; callers retain the `resetUI` function.

`dropdowns.js` owns the mode, language, and export dropdown listeners in their
original registration order, retaining `window._syncModeWithFiles` for the
attachment controller.
