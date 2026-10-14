# HTML → PPTX exporter verification

Verification date: 2026-09-28. Reference renderer: Microsoft PowerPoint COM
16.0.10417.20208. Each final slide was exported with
`Slide.Export(..., 'PNG', 1122, 631)`. Baseline and final use the same HTML
and hashes in `tests/fixtures/HASHES.json`.

Verified commits: `7742a45` (code, fixtures, and tests) and `87bb317`
(documentation, observability, and COM reproduction).

## Implemented coverage

| Area | Status | Evidence |
| --- | --- | --- |
| Border/radius/opacity hardening | Implemented | `docs/pptx-export-borders-radius.md`, dedicated fixture |
| Pseudo-elements | Implemented with documented degradation | `docs/pptx-export-pseudo.md`, inline runs and decorative shapes |
| Images/SVG | Implemented with raster fallback | `docs/pptx-export-images.md`, `pptx-images.html` |
| Tables | Implemented | `docs/pptx-export-tables.md`, `pptx-tables.html` |
| Robustness | Implemented | `docs/pptx-export-robustness.md`, warnings/debug/validation |
| Windows verification | Completed | COM, hashes, ZIP/XML, regression cases, and stress deck |

The suite passed `31/31`. Exporter changes preserved the user's preexisting
frontend modifications.

## Export implementation

- The measured intermediate model includes pseudo-runs, images/SVG/canvas,
  tables, background cloning without duplicate text, isolated fallbacks,
  per-request debug output, and structured warnings.
- `pptx-export.js` handles radius/ellipse geometry, `prstDash` lines, alpha,
  `srcRect`, descriptions, native tables, SHA-256 media deduplication, and
  OOXML validation.
- `export-warnings.js` centralizes the catalog and `X-Export-Warnings` counts.
- `scripts/verify-pptx-export.js`, `render-pptx-com.ps1`, and
  `validate-pptx-package.ps1` provide command-line/COM reproduction.

## COM vs HTML metric

MAE is `Σ|COM - HTML| / (W×H×3)`, range `0..255`, over the whole slide
unless a region is specified. `delta = final - baseline`; negative values
are closer to HTML.

| Deck/slide | Baseline | Final | Delta | Affected region |
|---|---:|---:|---:|---:|
| borders-radius-opacity/1 | 4.903975 | 4.903975 | 0 | 5.357910 → 5.357910 |
| edge-effects/1 | 1.395411 | 1.395411 | 0 | — |
| generality-dark/1 | 5.080892 | 5.342591 | +0.261699 | localized header; cards 8.998107 → 8.928149 |
| generality-light/1 | 5.469828 | 5.456641 | -0.013187 | — |
| images/1 | 10.088587 | 5.508730 | -4.579857 | 10.589752 → 6.006858 |
| kendrick/1 | 10.512866 | 10.512866 | 0 | — |
| kendrick/2 | 7.556187 | 7.556187 | 0 | — |
| kendrick/3 | 5.456969 | 5.456969 | 0 | — |
| kendrick/4 | 8.668091 | 8.668091 | 0 | — |
| kendrick/5 | 10.840101 | 10.840101 | 0 | — |
| kendrick/6 | 6.342454 | 6.342454 | 0 | — |
| kendrick/7 | 9.303172 | 9.303172 | 0 | — |
| kendrick/8 | 6.354001 | 6.354001 | 0 | — |
| layer-edge/1 | 1.495750 | 1.495750 | 0 | — |
| minimal/1 | 1.196208 | 1.196208 | 0 | — |
| pseudo/1 | 6.465935 | 6.237909 | -0.228026 | 7.064453 → 6.815320 |
| regression-dark/1 | 8.630741 | 8.630741 | 0 | — |
| regression-light/1 | 3.147872 | 3.147872 | 0 | — |
| shadows/1 | 5.213686 | 5.213686 | 0 | — |
| tables/1 | 7.766409 | 7.766409 | 0 | 8.485305 → 8.485305 |

The only positive delta is `generality-dark`. Its header changed from two
mispositioned text shapes to a measured inline run. The card region improves
and the final result matches HTML structurally, but PowerPoint measures the
run combination differently from Chromium. This is a documented A/C difference.

The stress deck has 32 slides, with baseline/final mean MAE `3.016648` per
slide in the final direct comparison. PPTX size is approximately `469411`
bytes; COM PNGs total `2772518` bytes. No missing slides or server page leaks
were observed.

## Final warnings

| Deck | Count by type |
|---|---|
| borders-radius-opacity | radius-approx 2, border-fallback 2, opacity-group 1 |
| edge-effects | opacity-group 1, radius-approx 1, overflow-clipping 1, position-fallback 2, visibility-fallback 1 |
| generality-dark/light | opacity-group 1 each |
| images | radius-approx 6, overflow-clipping 1, opacity-group 1, image-load-failed 3 |
| kendrick | font-substitution 24, radius-approx 1 |
| layer-edge | opacity-group 1, overflow-clipping 1, position-fallback 2, visibility-fallback 1 |
| pseudo | pseudo-fallback 2 |
| regression-dark/light, minimal, tables, stress | 0 |
| shadows | shadow-fallback 2, filter-fallback 1 |

No shadow, failed image, complex pseudo-element, or unsupported node is
discarded without a warning. The `object-fit` fallback uses a screenshot of
the rendered node; native `srcRect` remains available for compatible models
and has an OOXML test.

## Generality and limitations

The exporter diff contains no deck-specific color, selector, or copy literals.
Font names are limited to fallback data and explicit substitution tests.
Generation prompts are separate from export logic. Versioned fixtures cover
light/dark decks, images, pseudo-elements, tables, borders, and stress cases.

Nonembedded web fonts can be substituted with Office families. Complex SVG,
canvas, filters, repeating backgrounds, clipped radii, and nested tables can
be rasterized. Pseudo-element `counter/attr/url` emits warnings. Keynote,
Google Slides, and a machine without the installed fonts were not verified.
PowerPoint COM opened all PPTX files without a repair warning.

## Reproduction

On Windows with Node, Puppeteer's Chromium, and PowerPoint installed:

```powershell
npm run verify:pptx
```

The command validates hashes, generates fixtures with `?debug=1`, validates
ZIP/XML/relationships, and exports slides to PNG with PowerPoint COM in
`tmp/verify-pptx/com/`. The historical visual comparison script is
`tmp/phase5-metrics.py`; it requires bundled Python with Pillow.

Manual-review artifacts use `tmp/phase5-final-*.pptx` and
`tmp/phase5-final-*-powerpoint-render/`. Cell maps are in
`pptx-pseudo.html`, `pptx-images.html`, `pptx-tables.html`, and
`pptx-borders-radius-opacity.html`.
