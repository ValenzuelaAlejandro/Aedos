# HTML → PPTX pseudo-elements

Extraction uses `getComputedStyle(el, '::before/::after')` and preserves
paint order with `zKey`: `::before` precedes parent content and `::after`
follows its children. A static text pseudo-element without effects becomes
a run in the parent's paragraph, with its own CSS-measured color, family,
size, weight, style, shadow, and spacing. Absolute or decorative
pseudo-elements (`content:""`) remain separate shapes.

Replaced elements and zero-size pseudo-elements are ignored. `\\201C`,
`\\2022`, and equivalent hex escapes are decoded. `counter()`,
`counters()`, `attr()`, and `url()` emit `pseudo-fallback`;
transform, filter, mask, and blend also emit warnings while preserving parent
text. Isolated capture of complex pseudo-elements remains a limitation:
the exporter does not invent a raster containing the parent or siblings.

`tests/fixtures/pptx-pseudo.html` covers inline runs, quotes, rules, empty
badges, counter, attr, transform, and clearfix. Inspect final output in
`tmp/phase5-final-pseudo-powerpoint-render/slide-1.png`.
