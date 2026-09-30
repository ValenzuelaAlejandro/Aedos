# Export

Responsabilidad: renderizar y postprocesar formatos finales sin cambiar los handlers ni los contratos HTTP.

- `pdf.js`: render PDF con Puppeteer, normalización de layout y metadatos `pdf-lib`.
- `pptx-finalize.js`: validación y respuesta de `finalize-pptx`, incluido el TTL del archivo.
- `pptx-renderer.js`: renderer editable PPTX movido íntegramente desde la fachada; conserva la excepción monolítica por timing y warnings.
- `utils/pptx-export.js` permanece sin cambios y contiene las primitivas de exportación compartidas.

El renderer conserva una supresión de lint acotada a las reglas históricas del
bloque movido: dividirlo o reescribirlo para satisfacer `max-lines` alteraría
el orden de captura, rasterización, warnings y empaquetado.
También conserva `@ts-nocheck` porque el bloque evalúa DOM dentro de Puppeteer;
su chequeo generaba errores nuevos solo por cambiar el archivo contenedor.
