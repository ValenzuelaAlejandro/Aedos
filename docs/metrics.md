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
