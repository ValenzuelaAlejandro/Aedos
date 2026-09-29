# Export

Responsabilidad: renderizar y postprocesar formatos finales sin cambiar los handlers ni los contratos HTTP.

- `pdf.js`: render PDF con Puppeteer, normalización de layout y metadatos `pdf-lib`.
- `pptx-finalize.js`: validación y respuesta de `finalize-pptx`, incluido el TTL del archivo.
- La conversión editable PPTX continúa en `utils/pptx-export.js`; esta fase solo extrae su orquestación pendiente.
