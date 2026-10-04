# Preview feature

`overlay-style.js` inserts the existing image-slot stylesheet at the same
point in preview initialization. The remaining overlay lifecycle still lives
in `scripts/app.js` until its listener and state dependencies can be moved
together without changing event order.

`overlay-labels.js` creates the parent-side input and label for each image slot.
The factory receives the live overlay map and replacement callbacks; the app
invokes it at the former assignment point, so listener registration order stays
unchanged.
