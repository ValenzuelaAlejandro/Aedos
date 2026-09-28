# Bordes, radios y opacidad en PPTX editable

## Mapeo

- `opacity` propio y de ancestros se multiplica en el navegador y se aplica a
  fills, líneas, gradiente, texto, sombras y `a:alphaModFix` de imágenes.
- `opacity: 0`, `display:none` y `visibility:hidden` se omiten.
- Un radio uniforme se exporta como `a:prstGeom prst="roundRect"` con
  `adj = round(radius / min(width, height) × 100000)`, limitado a `50000`.
  Un cuadrado con radio igual a la mitad de su lado usa `ellipse`; un radio
  grande en una caja rectangular produce una píldora `roundRect`.
- Un borde uniforme usa `a:ln cmpd="sng"`, con color/alpha y `a:prstDash`
  (`solid`, `dash` o `sysDot`). El rectángulo geométrico se reduce y desplaza
  media anchura para compensar que PowerPoint centra la línea sobre la forma,
  mientras CSS pinta el borde dentro del `border-box`.
- Bordes distintos por lado se descomponen en cuatro rectángulos editables.
  Las tiras laterales empiezan debajo del borde superior y terminan encima del
  inferior para evitar doble cobertura en las esquinas.
- `outline` sin borde se trata como borde equivalente. `outline-offset` no
  tiene una representación nativa segura y registra warning.
- La sombra ring (`0 0 0 Npx`) reutiliza el borde editable del bloque 4.2.

## Fallbacks deliberados

Radios elípticos/distintos, o un `border-radius` con `overflow:hidden` y hijos,
se rasterizan como una captura PNG del nodo raíz para conservar clipping y
curvatura. Bordes distintos combinados con radio también se rasterizan. Se
emite siempre un warning estructurado con esta forma:

```json
{
  "slide": 1,
  "selector": ".card",
  "tipo": "radius-approx",
  "motivo": "esquinas elípticas o radios distintos",
  "fallback": "roundRect con radio máximo"
}
```

Los estilos `double`, `groove`, `ridge`, `inset` y `outset` conservan ancho y
color, pero degradan el patrón a `solid` con `border-fallback`. Un elemento no
soportado no cancela la generación del archivo.

## Verificación OOXML

Los tests comprueban `adj`, el uso del lado menor, el clamp de píldoras,
`ellipse`, `cmpd="sng"`, los patrones de línea, alpha de fills/líneas/gradientes/
texto/sombras/imágenes y la compensación geométrica. El `effectLst` de sombras
queda después de `a:ln` dentro de `p:spPr`.

Los fixtures permanentes `pptx-generality-light.html` y
`pptx-generality-dark.html` contienen ahora radio nativo, bordes sólido/dashed
o dotted y un grupo con alpha 0.5 y sombra. El fixture independiente de
sombras cubre offset, blur, alpha, ring, múltiples, inset y text-shadow.
