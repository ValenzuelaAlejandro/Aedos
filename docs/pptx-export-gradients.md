# Gradientes en la exportación PPTX

El exportador usa el mismo modelo `items` que el resto de elementos editables. Un
`linear-gradient()` o un `radial-gradient()` simple se conserva como fill nativo
OOXML; el texto y las formas que lo rodean siguen siendo objetos editables.

## Conversión de ángulos

El parser conserva los grados CSS antes de convertirlos a OOXML. CSS usa 0° hacia
arriba y aumenta en sentido horario; DrawingML usa 0° hacia la derecha. Por eso la
conversión es:

```text
ooxmlAngle = ((cssAngle - 90 + 360) % 360) * 60000
```

Para `to bottom right`, la dirección se calcula con el aspect ratio de la caja:
`90 + atan2(height, width)` en grados. Así una caja cuadrada produce 135° y una
caja de 200×100 px produce 116.565°.

## Stops y transparencia

Los stops se normalizan a posiciones de 0 a 100000. Los stops sin posición se
distribuyen linealmente entre los stops vecinos. `rgba()` conserva su alpha y
`transparent` reutiliza el color sólido más cercano con alpha 0 para evitar el
oscurecimiento que produciría interpolar desde negro transparente.

## Degradación controlada

`repeating-*`, `conic-gradient`, múltiples capas, `background-blend-mode`, máscaras
y gradientes de texto no tienen un equivalente nativo seguro en este exportador.
Esas regiones se capturan a DPR 2 como PNG local, se insertan en el mismo z-order y
se registra un warning estructurado `gradient-fallback` con
`fallback: "rasterized-region"`. Nunca se degrada silenciosamente a un color sólido.

La comprobación disponible en este entorno usa `render_slides.py` de la skill de
presentaciones, que importa el PPTX con `@oai/artifact-tool` 2.8.59. Inicialmente
ocultaba texto en algunos slides porque Chromium entrega `transparent` como
`rgba(0, 0, 0, 0)` y ese RGB negro llegaba al XML. El parser ahora sustituye el RGB
de cualquier stop con alpha 0 por el stop sólido más cercano; los slides afectados
vuelven a renderizarse con texto visible y el XML conserva el fill nativo. Se abrió y
exportó el deck con Microsoft PowerPoint `16.0.10417.20208` sin reparación; `soffice`
no está instalado en este entorno, por lo que no se hizo una comparación LibreOffice.
La diferencia residual de píxeles en los paneles diagonales se clasifica como C:
interpolación/rasterización legítimamente distinta entre Chromium y PowerPoint,
no como un RGB o alpha incorrecto en OOXML. La evidencia es el fixture sólido
135°: cambiar únicamente `scaled="0"` a `scaled="1"` empeora el MAE regional de
0.791975 a 5.664315 en PowerPoint; por tanto no se corrige alterando la escala
del gradiente.
