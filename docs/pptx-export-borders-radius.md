# Borders, corner radii, and opacity in editable PPTX

## Mapping

- The browser multiplies an element's own `opacity` by ancestor opacity and
  applies it to fills, lines, gradients, text, shadows, and image `a:alphaModFix`.
- `opacity: 0`, `display:none`, and `visibility:hidden` are omitted.
- A uniform radius exports as `a:prstGeom prst="roundRect"` with
  `adj = round(radius / min(width, height) × 100000)`, capped at `50000`.
  A square with a radius of half its side uses `ellipse`; a large radius on
  a rectangular box produces a `roundRect` pill.
- A uniform border uses `a:ln cmpd="sng"`, color/alpha, and `a:prstDash`
  (`solid`, `dash`, or `sysDot`). The geometry rectangle shrinks and shifts
  by half the border width: PowerPoint centers the line on the shape, while
  CSS paints the border inside the `border-box`.
- Different borders per side become four editable rectangles. Side strips
  start below the top border and end above the bottom to avoid double coverage
  at corners.
- An `outline` without a border becomes an equivalent border.
  `outline-offset` has no safe native representation and records a warning.
- A ring shadow (`0 0 0 Npx`) reuses the editable border from block 4.2.

## Intentional fallbacks

Elliptical/different radii, or `border-radius` with `overflow:hidden` and
children, become a PNG capture of the root node to preserve clipping and
curvature. Different borders combined with a radius are also rasterized.
A structured warning always uses this shape (the field names are the existing
runtime contract):

```json
{
  "slide": 1,
  "selector": ".card",
  "tipo": "radius-approx",
  "motivo": "elliptical corners or different radii",
  "fallback": "roundRect with maximum radius"
}
```

`double`, `groove`, `ridge`, `inset`, and `outset` retain width and color
but degrade to `solid` with `border-fallback`. An unsupported element does
not cancel file generation.

## OOXML verification

Tests check `adj`, use of the shorter side, pill clamping, `ellipse`,
`cmpd="sng"`, line patterns, alpha on fills/lines/gradients/text/shadows/images,
and geometry compensation. Shadow `effectLst` follows `a:ln` inside `p:spPr`.

Permanent fixtures `pptx-generality-light.html` and
`pptx-generality-dark.html` include native radii, solid/dashed/dotted borders,
and a group with alpha 0.5 and a shadow. The separate shadow fixture covers
offset, blur, alpha, ring, multiple shadows, inset, and text-shadow.
