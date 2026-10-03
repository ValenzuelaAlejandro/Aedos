# Minimap feature

`minimap.js` owns the feature lifecycle: slide thumbnails, observers, add/delete/
duplicate actions, and event wiring. `minimap-view.js` contains the view and
ordering helpers (active centering, thumbnail scale recalculation, drag target,
and persistence of slide order).

The public compatibility entry points remain `window.initMinimap` and
`window.syncMinimapActiveState`. The helper script must load before
`minimap.js` in `index.html`. Preserve current iframe selectors, 1122×631
thumbnail dimensions, transform timing, event order, and the 15-slide limit.
`window.AedosMinimapView` is an internal factory bridge, not an application API.
