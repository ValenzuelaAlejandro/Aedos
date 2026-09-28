# Imágenes y SVG

`<img>`, SVG inline y canvas se miden con el DOM ya renderizado y se capturan a
PNG cuando el contenido no tiene una traducción editable segura. El `alt` o
`aria-label` se escribe en `p:cNvPr/@descr`; `alt=""` y
`role="presentation"` dejan la descripción vacía. La captura respeta el
`object-fit` y `object-position` que ya pintó Chromium, evitando reconstruir un
`cover` desde la fuente cuando eso produciría un recorte distinto.

El exportador conserva el cálculo `srcRect` para modelos que lo proporcionen y
lo valida en tests, pero la ruta DOM actual usa el screenshot del nodo para
`cover/contain/fill`: es la degradación más fiel para PowerPoint real. Las
imágenes con `border-radius`/`overflow:hidden` se rasterizan una sola vez en
el nodo propietario; los descendientes no se vuelven a emitir. Backgrounds
complejos se rasterizan por región, con el texto directo oculto en el clon para
evitar duplicarlo. Medios idénticos se deduplican por SHA-256.

Los fallos de carga no abortan el deck y aparecen como `image-load-failed`.
`WebP`, `AVIF`, GIF animado, filtros y SVG complejo quedan rasterizados. La
limitación conocida es que esos elementos dejan de ser editables internamente,
pero el resto de la diapositiva conserva shapes y texto editables.

Fixture manual: `tmp/phase5-final-images.pptx` y
`tmp/phase5-final-images-powerpoint-render/slide-1.png`.
