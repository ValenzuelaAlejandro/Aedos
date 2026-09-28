# Pseudo-elementos HTML → PPTX

La extracción usa `getComputedStyle(el, '::before/::after')` y conserva el
orden de pintura mediante `zKey`: `::before` queda antes del contenido del
padre y `::after` después de sus hijos. Un pseudo textual estático y sin
efectos se agrega como run al párrafo del padre, con su propio color, familia,
tamaño, peso, estilo, sombra y espaciado medido en CSS. Los pseudo absolutos o
decorativos (`content:""`) siguen siendo shapes independientes.

Se ignoran elementos reemplazados y pseudo de tamaño cero. `\\201C`, `\\2022`
y escapes hex equivalentes se decodifican. `counter()`, `counters()`, `attr()`
y `url()` emiten `pseudo-fallback`; transform, filter, mask y blend también
emiten warning y conservan el texto del padre. La captura aislada de pseudo
complejos queda como limitación: no se inventa un raster que incluya padre o
hermanos.

El fixture `tests/fixtures/pptx-pseudo.html` cubre runs inline, quote, regla,
badge vacío, counter, attr, transform y clearfix. La salida final se inspecciona
en `tmp/phase5-final-pseudo-powerpoint-render/slide-1.png`.
