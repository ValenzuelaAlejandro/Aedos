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

## Extensión visible por blur

Para medir la cola se usó una caja blanca de 322×120 px sobre `#f8fafc`, sombra
centrada con alpha 0.5, y umbral de visibilidad `alpha >= 0.01` (aprox. 2.5/255
de oscurecimiento). La extensión es la distancia desde el borde inferior hasta
el último píxel que supera el umbral; PowerPoint es el PNG exportado por COM.

| Blur CSS | blurRad usado (EMU) | Chromium (px) | PowerPoint (px) | error (px) |
| ---: | ---: | ---: | ---: | ---: |
| 4 | 43,465 | 3 | 2 | 1 |
| 8 | 86,930 | 7 | 5 | 2 |
| 12 | 130,396 | 12 | 7 | 5 |
| 24 | 260,791 | 24 | 16 | 8 |
| 48 | 521,583 | 45 | 32 | 13 |

El error crece con blur; no es una relación perfectamente lineal. Evalué una
corrección global 1.5× y 2.0× sobre el mismo XML: 1.5× produjo extensiones
`[3,7,11,24,49]` y errores `[0,0,1,0,4]`, mientras 2.0× produjo
`[5,10,16,32,67]` y errores `[2,3,4,8,22]`. No se activa automáticamente 1.5×:
en el fixture completo de sombras su MAE agregado fue 5.431328 frente a 5.428843
con 1.0×, y la región inset empeoró. La diferencia queda documentada como
limitación de rasterizado de PowerPoint; el factor 1.0 conserva la mejor métrica
global entre los casos editables combinados.

En el deck oscuro, el slide completo pasó de 8.411194 a 8.479195, pero la región
de la tarjeta y su halo mejoró de 4.203094 a 3.827256. La franja inferior de la
sombra mejoró de 0.844164 a 0.207949 y el halo derecho de 3.868579 a 3.518736.
El empeoramiento global proviene de la diferencia de blur fuera de la región
afectada, no de una sombra ausente o duplicada.

## Fallbacks

- `0 0 0 Npx` se trata como borde equivalente y no como `outerShdw`.
- Múltiples sombras o `inset` aplican la dominante por `alpha × blur` y registran
  `shadow-fallback` con selector, motivo y fallback.
- `spread` distinto de cero se aproxima sin spread y registra warning.
- `filter: drop-shadow()` o `blur()` rasteriza el nodo raíz completo a PNG y
  registra `filter-fallback`; los hijos no se emiten de nuevo.
- `text-shadow` simple se conserva dentro del `a:rPr` de cada run.
