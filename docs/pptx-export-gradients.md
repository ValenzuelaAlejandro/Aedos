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

La comprobación disponible en este entorno usa el renderer auxiliar de la skill de
presentaciones. Ese renderer tiene una limitación conocida con un `a:gradFill` que
contiene stops con alpha 0 y puede ocultar texto posterior en algunos slides; el
XML conserva los textos, las relaciones y el fill nativo. No se pudo verificar esa
combinación en PowerPoint de escritorio ni en LibreOffice dentro de este entorno.
