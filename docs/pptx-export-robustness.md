# Robustness and observability

`src/backend/utils/export-warnings.js` is the single catalog. Warnings
normalize to `{ slide, selector, tipo, motivo, fallback }`, are deduplicated
by slide/selector/type/reason, written to logs, and summarized in
`X-Export-Warnings`. HTML without an exportable slide produces `400`
with `contract-violation`. The existing Spanish field names are runtime
contract identifiers.

With `?debug=1` or `EXPORT_DEBUG=1`, each request saves:

- `input.html`, `slideData.json`, and `warnings.json`;
- one DOM screenshot per slide;
- rasterized PNGs for each fallback;
- generated `slideN.xml`.

Before responding, package validation checks well-formed XML, image/hyperlink
relationships, unique IDs per slide, media deduplication, gradient order, and
absence of `normAutofit`. The Puppeteer page closes in `finally`. Existing
concurrency, size, and time limits remain active.

Final COM validation opened every fixture without a repair dialog.
Keynote, Google Slides, and fonts missing from the destination machine
could not be verified.
