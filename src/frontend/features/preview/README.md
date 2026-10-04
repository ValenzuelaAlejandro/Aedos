# Preview feature

`overlay-style.js` inserts the existing image-slot stylesheet at the same
point in preview initialization. The remaining overlay lifecycle still lives
in `scripts/app.js` until its listener and state dependencies can be moved
together without changing event order.
