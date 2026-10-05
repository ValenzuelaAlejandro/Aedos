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
