# Robustez y observabilidad

`src/backend/utils/export-warnings.js` es el catálogo único. Los warnings se
normalizan a `{ slide, selector, tipo, motivo, fallback }`, se deduplican por
slide/selector/tipo/motivo, se escriben en log y se resumen en
`X-Export-Warnings`. Un HTML sin slide exportable produce `400` con
`contract-violation`.

Con `?debug=1` o `EXPORT_DEBUG=1` se guarda por request:

- `input.html`, `slideData.json` y `warnings.json`;
- una captura DOM por slide;
- PNGs rasterizados de cada fallback;
- `slideN.xml` generado.

Antes de responder se valida el paquete: XML bien formado, relaciones de
imágenes/hipervínculos, IDs únicos por slide, media deduplicado, orden de
gradientes y ausencia de `normAutofit`. La página Puppeteer se cierra en
`finally`. Los límites existentes de concurrencia, tamaño y tiempo siguen
activos.

La validación COM final abrió todos los fixtures sin diálogo de reparación.
No se pudo verificar Keynote, Google Slides ni fuentes no instaladas en el
equipo destino.
