# HTML → PPTX fidelity metrics

## Full-slide MAE

For HTML image `H` and PowerPoint-rendered PNG `P`, both of size `W × H`:

```text
MAE = Σ |P(x,y,c) - H(x,y,c)| / (W × H × 3)
```

`c` ranges over R, G, and B. The scale is `0..255`; `0` means exact
equality. This metric includes the entire slide: text, images, and backgrounds.
Historical reports with values `5..12` use this scale and PowerPoint-exported
PNGs rather than an isolated region.

## Gradient-region MAE

To separate gradient rasterization from the rest of the design, the same
formula is calculated only within the gradient box. Alpha checks use 10
columns (`x = 160,250,...,970`) × 5 rows (`y = 268..272`): 50 pixels and
150 channels. The scale remains `0..255`; alpha fixture values
`0.39..0.71` are therefore much more local than full-slide MAE.

The 520×420 px diagonal fixture uses the complete box region, not the slide.
Reference values compare Chromium against the PNG exported through COM by
PowerPoint 16.0.10417.20208.

The controlled alpha-fix test on that 10×5 pixel strip produced fixed MAE
`0.655802, 0.649136, 0.576955, 0.516790, 0.584938` for cases A–E.
Artificially replacing the alpha-0 stop RGB with black produced
`15.912346, 15.905844, 15.820165, 0.450123, 4.396296` for the same cases.
This shows black RGB was cause A where it contributed to the measured region;
case D does not interpolate that stop in the strip, so it does not change.

For solid `linear-gradient(135deg, ...)`, full 520×420 px region MAE was
`0.791975` with `scaled="0"` and `5.664315` with `scaled="1"`.
`scaled="0"` is retained; the OOXML angle is not recalculated because the
real experiment worsens box fidelity. Earlier MAE from another sampling
window (`1.441394`) measured a different region and is not mixed with this metric.

## Baseline → final delta

For each fixture and slide:

```text
delta = MAE(final, HTML) - MAE(baseline, HTML)
```

`delta < 0` improves fidelity; `delta > 0` worsens it. A regression is
accepted only with diagnosis and localized evidence. The baseline is
`tmp/phase4b-baseline-*-powerpoint-render/`, never the alternative renderer.

## Gradient decisions

`GRADIENT_ALPHA_MODE = native`: simple gradients retain stops, color, and
alpha in `<a:gradFill>`. This was chosen because real PowerPoint opened and
exported alpha fixtures without a repair warning. Repeating, conic,
multilayer, and blend/mask gradients retain raster fallback with structured warnings.
