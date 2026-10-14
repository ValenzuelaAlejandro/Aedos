# Images and SVG

`<img>`, inline SVG, and canvas are measured in the rendered DOM and captured
as PNG when no safe editable translation exists. `alt` or `aria-label`
becomes `p:cNvPr/@descr`; `alt=""` and `role="presentation"` leave the
description empty. Captures respect the `object-fit` and `object-position`
already painted by Chromium, avoiding a reconstruction of `cover` from
the source that would produce different cropping.

The exporter retains and tests `srcRect` calculations for models that
provide them, but the current DOM path uses a node screenshot for
`cover/contain/fill`: the most faithful degradation in real PowerPoint.
Images with `border-radius`/`overflow:hidden` are rasterized once at the
owning node; descendants are not emitted again. Complex backgrounds are
rasterized by region, hiding direct text in the clone to avoid duplication.
Identical media are deduplicated by SHA-256.

Load failures do not abort the deck and appear as `image-load-failed`.
WebP, AVIF, animated GIF, filters, and complex SVG are rasterized. These
elements lose internal editability, but the rest of the slide retains
editable shapes and text.

Manual fixture: `tmp/phase5-final-images.pptx` and
`tmp/phase5-final-images-powerpoint-render/slide-1.png`.
