# Editable PPTX shadows

## Native mapping

A simple CSS shadow becomes `a:effectLst/a:outerShdw` inside `p:spPr`,
after `a:ln`. Distance uses the magnitude of offsets in EMU.

```text
dist = hypot(pxToEmu(x), pxToEmu(y))
dir  = normalize(atan2(y, x) × 60000)
blurRad = pxToEmu(cssBlur) × CSS_BLUR_TO_SHADOW_RAD
```

Color and alpha remain in `a:srgbClr/a:alpha`. Direction is measured
clockwise from the right and normalized to `0..360°`.

## PowerPoint calibration

PowerPoint `16.0.10417.20208` exported the fixture to PDF through COM,
then it was converted to PNG. For the same HTML regions, total fixture MAE was:

| Factor | Total MAE | Simple region | Horizontal region | Negative region |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 | 5.701709 | 5.875011 | 5.754902 | 6.285971 |
| 1.0 | 5.428843 | 4.780909 | 4.989965 | 6.033263 |
| 1.5 | 5.431328 | 4.709270 | 4.699206 | 5.715966 |

Factor 1.0 minimizes aggregate MAE and avoids the inset-region regression
seen with 1.5. Calibration does not claim identical PowerPoint/Chromium blur;
it establishes the best empirical OOXML attribute scale for this renderer.

## Visible blur extent

Tail measurement used a 322×120 px white box over `#f8fafc`, a centered
shadow with alpha 0.5, and visibility threshold `alpha >= 0.01`
(approximately 2.5/255 darkening). Extent is the distance from the bottom edge
to the last pixel above the threshold; PowerPoint values come from COM PNGs.

| CSS blur | Applied blurRad (EMU) | Chromium (px) | PowerPoint (px) | Error (px) |
| ---: | ---: | ---: | ---: | ---: |
| 4 | 43,465 | 3 | 2 | 1 |
| 8 | 86,930 | 7 | 5 | 2 |
| 12 | 130,396 | 12 | 7 | 5 |
| 24 | 260,791 | 24 | 16 | 8 |
| 48 | 521,583 | 45 | 32 | 13 |

Error grows with blur and is not perfectly linear. Global 1.5× and 2.0×
corrections were evaluated on the same XML: 1.5× produced extents
`[3,7,11,24,49]` and errors `[0,0,1,0,4]`; 2.0× produced
`[5,10,16,32,67]` and errors `[2,3,4,8,22]`. Factor 1.5× is not applied
automatically: full-fixture aggregate MAE was 5.431328 versus 5.428843 at
1.0×, and the inset region worsened. This is documented as a PowerPoint
rasterization limitation; 1.0 retains the best global metric across
combined editable cases.

In the dark deck, full-slide MAE went from 8.411194 to 8.479195, while the card
and halo region improved from 4.203094 to 3.827256. The bottom shadow strip
improved from 0.844164 to 0.207949 and the right halo from 3.868579 to 3.518736.
The overall regression comes from blur differences outside the affected
region, not a missing or duplicated shadow.

## Fallbacks

- `0 0 0 Npx` becomes an equivalent border rather than `outerShdw`.
- Multiple shadows or `inset` apply the dominant shadow by `alpha × blur`
  and record `shadow-fallback` with selector, reason, and fallback.
- Nonzero `spread` is approximated without spread and records a warning.
- `filter: drop-shadow()` or `blur()` rasterizes the complete root node
  to PNG with `filter-fallback`; children are not emitted again.
- Simple `text-shadow` remains inside each run's `a:rPr`.
