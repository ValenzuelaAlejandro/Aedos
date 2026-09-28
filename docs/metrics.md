# Métricas de fidelidad HTML → PPTX

## MAE de slide completo

Para una imagen HTML `H` y el PNG renderizado por PowerPoint `P`, ambas con el
mismo tamaño `W × H`, usamos:

```text
MAE = Σ |P(x,y,c) - H(x,y,c)| / (W × H × 3)
```

`c` recorre R, G y B. El rango es `0..255`; `0` significa igualdad exacta.
Esta métrica usa todo el slide, incluyendo texto, imágenes y fondos. Los
reportes históricos con valores `5..12` son de esta escala y de PNG exportado
por PowerPoint, no de una región aislada.

## MAE de región de gradiente

Para separar el rasterizado del gradiente del resto del diseño, calculamos la
misma fórmula sólo en la caja del gradiente. En la comprobación alpha usamos 10
columnas (`x = 160,250,...,970`) × 5 filas (`y = 268..272`), 50 píxeles y 150
canales. El rango sigue siendo `0..255`; los valores `0.39..0.71` de los
fixtures alpha son por tanto mucho más locales que el MAE de slide completo.

Para el fixture diagonal de 520×420 px se usa la región completa de la caja,
no el slide. Los valores de referencia se comparan entre Chromium y el PNG que
PowerPoint 16.0.10417.20208 exporta por COM.

La prueba controlada del fix alpha, en esa tira de 10×5 píxeles, dio MAE fijo
`0.655802, 0.649136, 0.576955, 0.516790, 0.584938` para los casos A–E.
Al sustituir artificialmente el RGB del stop alpha=0 por negro, los mismos
casos dieron `15.912346, 15.905844, 15.820165, 0.450123, 4.396296`. Esto
demuestra que el RGB negro sí era causa A en los casos donde participa en la
región medida; el caso D no interpola ese stop en la tira y por eso no cambia.

Para el gradiente diagonal sólido `linear-gradient(135deg, ...)`, la región
completa de 520×420 px tuvo MAE `0.791975` con `scaled="0"` y `5.664315` con
`scaled="1"`. Se conserva `scaled="0"`; no se recalcula el ángulo OOXML porque
el experimento real empeora la fidelidad de la caja. El MAE anterior de otra
ventana de muestreo (`1.441394`) era de una región distinta y no se mezcla con
esta métrica.

## Delta baseline → final

En cada fixture y slide:

```text
delta = MAE(final, HTML) - MAE(baseline, HTML)
```

`delta < 0` mejora, `delta > 0` empeora. Un empeoramiento sólo se acepta con
diagnóstico y evidencia localizada; el baseline es
`tmp/phase4b-baseline-*-powerpoint-render/` y nunca el renderer alternativo.

## Decisiones de gradiente

`GRADIENT_ALPHA_MODE = native`: los gradientes simples conservan stops, color y
alpha en `<a:gradFill>`. Se eligió porque PowerPoint real abrió y exportó los
fixtures con alpha sin aviso de reparación. Gradientes repeating, conic,
múltiples capas o blend/mask siguen el fallback rasterizado con warning
estructurado.
