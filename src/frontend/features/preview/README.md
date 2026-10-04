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

`slide-input.js` owns the existing keyboard, wheel, and swipe handlers. The
factory registers document keyboard/wheel listeners at their former point and
returns wheel/touch handlers for iframe registration by `app.js`.

`slot-image-replacement.js` owns file/URL image replacement and slot styling.
It receives the existing content utility and is instantiated where the old
replacement functions were defined.

`overlay-positioning.js` owns stale-label cleanup and viewport positioning. It
receives the current overlay map each time the iframe overlay setup runs.

`overlay-labels.js` creates the parent-side input and label for each image slot.
The factory receives the live overlay map and replacement callbacks; the app
invokes it at the former assignment point, so listener registration order stays
unchanged.
