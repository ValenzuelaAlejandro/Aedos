# HTML → PPTX: stacking y orden de capas

El exportador captura cada elemento visible del slide con un `domIndex` pre-order,
`contextId` y `zKey`. Los pseudo-elementos reciben índices durante el mismo recorrido:
`::before` se asigna después del padre y antes de sus hijos; `::after`, después de los
hijos. El escritor ordena `items` por `zKey` y, en empate, por `domIndex` antes de
emitirlos en `p:spTree`; en PowerPoint ese orden es el z-order.

## Aproximación aplicada

- Se crea stacking context para `position` con `z-index` no `auto`, `opacity < 1`,
  `transform`, `filter`, `isolation:isolate`, `will-change` relevante y para items
  flex/grid con `z-index` explícito.
- Cada contexto aporta `[grupo, z-index, domIndex]`, donde `grupo` es `-1` para
  negativos, `0` para auto/0 y `1` para positivos.
- Dentro del contexto usamos fases aproximadas: fondo/borde `0`, `::before` `1`,
  contenido normal `2` y `::after` `3`. Un shape y su texto propio comparten
  `domIndex` y el texto recibe una parte posterior.
- El fondo del slide se emite siempre antes de los `items`.
- `position:fixed` y `sticky` se miden respecto al viewport que coincide con el
  slide; si intersectan el slide se tratan como elementos absolutos.

## Limitaciones

Esto no implementa todo el algoritmo CSS: floats, inline formatting contexts,
`mix-blend-mode`, `backdrop-filter`, máscaras, compositing de grupos y ciertos
casos de `contain` no tienen una representación editable equivalente en PPTX.
`opacity < 1` se propaga como alpha a fills/textos soportados; PPTX no puede
agrupar la opacidad de hijos editables, por lo que se registra un warning.
`overflow:hidden` se conserva mediante la geometría del slide y se registra un
warning cuando un hijo desborda; no se rasteriza el grupo automáticamente.
Elementos completamente invisibles, de tamaño cero o fuera del slide no se
exportan.
