# Visual browser snippets

`browser-snippets.js` contains self-contained functions passed to Puppeteer's
`page.evaluate` and `page.waitForFunction`. Puppeteer serializes these functions;
they must not close over Node.js module helpers. This directory is linted with
browser globals rather than Node globals.

The outline setup uses the `VisualSkeleton` JSDoc typedef declared in the source.
Screenshots are deterministic: the caller fixes viewport, theme, reduced motion,
and network access before invoking a snippet.
