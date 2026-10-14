# HTML → PPTX stacking and layer order

The exporter captures each visible slide element with a pre-order `domIndex`,
`contextId`, and `zKey`. Pseudo-elements receive indices in the same traversal:
`::before` follows the parent and precedes children; `::after` follows children.
The writer sorts `items` by `zKey`, breaking ties by `domIndex`, before
emitting them in `p:spTree`; that order is PowerPoint's z-order.

## Applied approximation

- Stacking contexts are created for positioned elements with non-`auto`
  `z-index`, `opacity < 1`, `transform`, `filter`,
  `isolation:isolate`, relevant `will-change`, and flex/grid items
  with explicit `z-index`.
- Each context contributes `[group, z-index, domIndex]`, with group `-1`
  for negative values, `0` for auto/0, and `1` for positive values.
- Approximate phases within a context are background/border `0`,
  `::before` `1`, normal content `2`, and `::after` `3`.
  A shape and its own text share `domIndex`, with text assigned a later part.
- The slide background always precedes `items`.
- `position:fixed` and `sticky` are measured against the viewport matching
  the slide; intersecting elements are treated as absolutely positioned.

## Limitations

This does not implement the entire CSS algorithm. Floats, inline formatting
contexts, `mix-blend-mode`, `backdrop-filter`, masks, group compositing,
and some `contain` cases have no equivalent editable PPTX representation.
`opacity < 1` propagates as alpha to supported fills/text. PPTX cannot group
the opacity of editable children, so a warning is recorded.
`overflow:hidden` is preserved through slide geometry, with a warning when
a child overflows; groups are not automatically rasterized.
Completely invisible, zero-size, or off-slide elements are not exported.

The versioned `tests/fixtures/pptx-layer-edge.html` covers opacity with
children, `overflow:hidden`, `position:fixed`, `position:sticky`,
and `visibility:hidden`/`opacity:0`. Export warnings retain the contract
`{ slide, selector, tipo, motivo, fallback }`. The test expects
`opacity-group` and `overflow-clipping`; hidden elements are omitted without
warnings because there is no visual loss.
