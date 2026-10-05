# Preview feature

`overlay-style.js` inserts the existing image-slot stylesheet at the same
point in preview initialization. The remaining overlay lifecycle still lives
in `scripts/app.js` until its listener and state dependencies can be moved
together without changing event order.

`zoom-controls.js` owns the zoom values, display updates, and button listeners.
`app.js` calls its factory at the former initialization point and keeps the
returned operations for the existing iframe scaling flow.

`slide-navigation.js` owns slide scrolling, cooldown navigation, desktop/mobile
dots, and counters. It receives the live preview state, existing DOM nodes, and
the overlay refresh getter; its `window.*` compatibility helpers are registered
at the former navigation initialization point.

`slide-discovery.js` preserves the ordered selector fallbacks used to locate
slides across generated HTML and legacy preview documents.

`slide-input.js` owns the existing keyboard, wheel, and swipe handlers. The
factory registers document keyboard/wheel listeners at their former point and
returns wheel/touch handlers for iframe registration by `app.js`.

`slot-image-replacement.js` owns file/URL image replacement and slot styling.
It receives the existing content utility and is instantiated where the old
replacement functions were defined.

`overlay-positioning.js` owns stale-label cleanup and viewport positioning. It
receives the current overlay map each time the iframe overlay setup runs.

`state-restore.js` owns the `state-restored` listener and re-keys existing slot
labels after editor undo/redo. Getters keep the overlay map and slot helpers
live across preview resets.

`iframe-scale.js` owns scaling and fullscreen padding state. `app.js` retains
the two fullscreen listener registrations at their original point.

`carousel-layout.js` owns the final slide sizing, rewind transition, overflow
reset, and scale scheduling after preview assets settle. The app invokes it at
the former layout block with its existing state and callbacks.

`layout-settler.js` waits for iframe images and fonts before interaction setup,
preserving the existing one-shot DOM flag and timeout fallbacks.

`interactions.js` owns iframe interaction setup and the `regenerateDotsCount`
compatibility helper. Its factory is invoked at the original bootstrap point;
state getters defer access until the iframe setup event, avoiding TDZ changes.

`overlay-labels.js` creates the parent-side input and label for each image slot.
The factory receives the live overlay map and replacement callbacks; the app
invokes it at the former assignment point, so listener registration order stays
unchanged.

`debug-title.js` extracts the existing title from localhost-only debug canvas
HTML. It registers its helper on the already-established `window.AedosPreview`
namespace; `app.js` retains its hoisted wrapper and fallback behavior.

`debug-canvas.js` owns the localhost-only debug button, endpoint checks, and
fetch/error lifecycle, plus the existing-HTML preview sequence. `app.js` injects
the live preview callbacks and initializes the factories at the original point
in the DOM-ready sequence.

`iframe-mount.js` owns generated HTML repair, document writing, iframe load
callbacks, and the original readiness polling schedule. Its factory is created
at the former `initPreview` declaration point and reads later-initialized preview
operations through getters when the mount runs.

`outside-deselect.js` registers the existing parent-document click-outside
listener at its original initialization point and calls the live iframe editor
selection API when the click is outside preview controls.

`stream-status.js` owns the live generation status text and accessible label
update. `app.js` retains the returned updater for the existing SSE event sites.

`markup-buffer.js` owns the live iframe HTML queue, two-million-character
limit, 80 ms flush timer, and success/error cleanup through one API.

`initial-stream-markup.js` writes the unchanged first-chunk iframe stylesheet,
font links, editor loader, and skeleton injector at the original SSE event.

`final-reveal.js` repairs final stylesheet links, remounts the generated iframe,
and reveals the settled editor chrome through the original timed sequence.

`message-bridge.js` owns the existing iframe progress/title message listener.
It reads later-initialized navigation dependencies only for slide updates.

`exit-actions.js` registers the existing back-to-chat and edit-topic confirmation
buttons and preserves their abort, navigation, resize, and focus ordering.

`surface-reset.js` clears the preview iframe, minimap, dots, and overlay state
through explicit setters when the existing error/reset path invokes it.
