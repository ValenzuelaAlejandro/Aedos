# Known issues congelados en 3c

Estos problemas se documentan, pero no se corrigen en esta fase porque cambiarían
el comportamiento observable o pertenecen a una fase de correcciones separada.

1. **Cola y `req.close`.** `src/backend/queues/generation.js` retira una
   solicitud sólo cuando el listener `req.on('close')` encuentra todavía el
   elemento en la cola. La evidencia operativa congelada es la reproducción de
   `req2`/`req3` colgadas y la ausencia del `429 QUEUE_FULL` esperado; el test
   automatizado actual sí cubre el `503 PRO_TEMPORARILY_PAUSED`. Corrección
   mínima propuesta, no aplicada: modelar explícitamente los estados de cada
   elemento y liberar/contabilizar desconexiones una sola vez.

2. **Sanitización HTML incompleta.** Las fixtures actuales muestran que se
   conservan casos como `iframe`, `object`, `embed`, `@import`,
   `url(javascript:...)` y algunos `data:text/html`. Evidencia: pares en
   `tests/fixtures/sanitization/embedded.*`, `style_import_url.*`,
   `style_attribute.*` y `data_urls.*`. Corrección mínima propuesta, no
   aplicada: ampliar la política/allowlist del sanitizer y regenerar snapshots.

3. **Error HTTP 500 de Multer.** Los límites multipart atraviesan Multer antes
   del handler de generación; los casos de campo inesperado y tamaño excedido
   conservan respuestas `MulterError`/`LIMIT_FILE_SIZE` en
   `tests/contracts/backend-contract.test.js`. Corrección mínima propuesta, no
   aplicada: middleware de error dedicado que traduzca cada código a un contrato
   4xx estable.

4. **Fallo Gemini a mitad de stream sin fallback.** El test
   `tests/contracts/provider-network.test.js` congela el terminal SSE cuando el
   stream ya empezó y se interrumpe: no se reinicia retrospectivamente ese
   stream con OpenRouter. Corrección mínima propuesta, no aplicada: buffering o
   reanudación explícita antes de emitir contenido irreversible.

5. **`npm audit` histórico.** El clon limpio de 3c.0 tras `npm ci` reportó 12
   vulnerabilidades (4 moderate, 8 high). En una consulta posterior del mismo
   workspace el registro devolvió 0, por lo que el dato queda fechado y no se
   interpreta como una corrección. No se ejecutó `npm audit fix`. Corrección
   mínima propuesta, no aplicada: actualizar dependencias de forma controlada y
   repetir baselines.

6. **Puppeteer puede intentar instalar Chrome al importar/inicializar.**
   `src/backend/browser/manager.js` llama a `installChrome()` cuando el cache no
   contiene un ejecutable; la inicialización eager ocurre desde `server.js`.
   Evidencia: ramas `findChromeExecutable`/`installChrome` y el log de runtime
   install. Corrección mínima propuesta, no aplicada: provisionar el cache en
   CI/deploy y fallar de forma explícita si falta, o volver lazy la inicialización
   tras una caracterización específica de timing.
