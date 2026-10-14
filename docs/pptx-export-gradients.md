# Gradients in PPTX export

The exporter uses the same `items` model as other editable elements. A simple
`linear-gradient()` or `radial-gradient()` remains a native OOXML fill;
surrounding text and shapes remain editable.

## Angle conversion

The parser preserves CSS degrees before converting to OOXML. CSS starts at 0°
upward and increases clockwise; DrawingML starts at 0° to the right.

```text
ooxmlAngle = ((cssAngle - 90 + 360) % 360) * 60000
```

For `to bottom right`, direction uses the box aspect ratio:
`90 + atan2(height, width)` in degrees. A square produces 135° and a
200×100 px box produces 116.565°.

## Stops and transparency

Stops normalize to positions from 0 to 100000. Stops without a position are
distributed linearly between neighboring stops. `rgba()` retains alpha;
`transparent` reuses the nearest solid color with alpha 0 to avoid darkening
from interpolation with transparent black.

## Controlled degradation

`repeating-*`, `conic-gradient`, multiple layers, `background-blend-mode`,
masks, and text gradients have no safe native equivalent in this exporter.
These regions are captured at DPR 2 as local PNGs, inserted at the same z-order,
and logged with a structured `gradient-fallback` warning and
`fallback: "rasterized-region"`. They never silently become a solid color.

Verification in this environment uses the presentations skill's
`render_slides.py`, which imports PPTX with `@oai/artifact-tool` 2.8.59.
Initially, some slides hid text because Chromium supplies `transparent` as
`rgba(0, 0, 0, 0)`, sending black RGB into XML. The parser now replaces RGB
for any alpha-0 stop with the nearest solid stop; affected slides render with
visible text and XML retains the native fill. Microsoft PowerPoint
`16.0.10417.20208` opened and exported the deck without repair. `soffice`
is not installed, so no LibreOffice comparison was performed.

Residual pixel differences in diagonal panels are classified as C: legitimate
interpolation/rasterization differences between Chromium and PowerPoint,
rather than incorrect OOXML RGB or alpha. In the solid 135° fixture, changing
only `scaled="0"` to `scaled="1"` worsens regional PowerPoint MAE from
0.791975 to 5.664315, so changing gradient scaling is not a correction.
