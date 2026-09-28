# Sombras editables PPTX

## Mapeo nativo

Una sombra CSS simple se convierte a `a:effectLst/a:outerShdw` dentro de
`p:spPr`, después de `a:ln`. La distancia usa el módulo de los offsets en EMU:

```text
dist = hypot(pxToEmu(x), pxToEmu(y))
dir  = normalize(atan2(y, x) × 60000)
blurRad = pxToEmu(cssBlur) × CSS_BLUR_TO_SHADOW_RAD
```

El color y alpha se conservan en `a:srgbClr/a:alpha`. La dirección se mide en
sentido horario desde la derecha y queda normalizada a `0..360°`.

## Calibración con PowerPoint

Se usó `16.0.10417.20208`, exportando el fixture a PDF por COM y convirtiéndolo
a PNG. Sobre las mismas regiones del HTML, el MAE total del fixture fue:

| Factor | MAE total | Región simple | Región horizontal | Región negativa |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 | 5.701709 | 5.875011 | 5.754902 | 6.285971 |
| 1.0 | 5.428843 | 4.780909 | 4.989965 | 6.033263 |
| 1.5 | 5.431328 | 4.709270 | 4.699206 | 5.715966 |

El factor 1.0 es el elegido porque minimiza el MAE agregado y evita el
empeoramiento observado en la región inset con 1.5. La calibración no pretende
que PowerPoint y Chromium produzcan el mismo blur: sólo fija la mejor escala
empírica del atributo OOXML para este renderer.

## Fallbacks

- `0 0 0 Npx` se trata como borde equivalente y no como `outerShdw`.
- Múltiples sombras o `inset` aplican la dominante por `alpha × blur` y registran
  `shadow-fallback` con selector, motivo y fallback.
- `spread` distinto de cero se aproxima sin spread y registra warning.
- `filter: drop-shadow()` o `blur()` rasteriza el nodo raíz completo a PNG y
  registra `filter-fallback`; los hijos no se emiten de nuevo.
- `text-shadow` simple se conserva dentro del `a:rPr` de cada run.
