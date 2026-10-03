# Known issues congelados en 3c

Estos problemas se documentan, pero no se corrigen en esta fase porque cambiarían
el comportamiento observable o pertenecen a una fase de correcciones separada.

1. **Cola y desconexión de petición — corregido.** `req.on('close')` también
   se dispara al terminar de leer el body, aunque la conexión HTTP siga viva;
   eso retiraba entradas válidas de la cola. `generation-queue-disconnect.test.js`
   reprodujo que la tercera conexión recibía 200 y quedaba esperando en vez del
   429 `QUEUE_FULL`. Corregido en `c133384`
   (`fix(queue): use response close for queued request cleanup`): ahora se
   elimina una entrada al cerrarse su response antes de terminar, y se
   desregistra el listener al adquirir o abandonar el slot. El test confirma
   429 real, FIFO y limpieza tras desconexión del cliente.

2. **Sanitización HTML — corregida parcialmente en `42987ac`, según el alcance
   autorizado.** El commit `fix(sanitization): block listed active content vectors` elimina
   `iframe`, `object`, `embed`, imports no permitidos, URLs `javascript:` y
   `data:text/html`, y declaraciones CSS con `expression()`, `behavior` o URLs
   peligrosas. Las fixtures adversariales están actualizadas. Las salidas
   sanitizadas y hashes de los ejemplos flash/pro siguen idénticos a HEAD antes
   del cambio; Google Fonts y `data:image/*` se conservan. No se amplió a una
   política HTML general ni a vectores no enumerados en esta tarea.

3. **Errores de validación Multer — corregidos en `459c932`.** El
   middleware dedicado traduce `LIMIT_FILE_SIZE` a HTTP 413 y JSON `{ error }`;
   exceso de cantidad, extensiones no permitidas y nombres sin extensión
   devuelven HTTP 400 en el mismo formato. El resto de errores no relacionados
   con la carga se siguen delegando a Express. Caso borde confirmado con la
   versión fijada: un archivo de exactamente 10 MiB también dispara
   `LIMIT_FILE_SIZE` y devuelve 413. La actualización ensayada a Multer 2.4.0
   cambió ese caso a 200, por lo que no se conserva sin una decisión explícita
   sobre el límite público.

4. **Fallo Gemini a mitad de stream sin fallback.** El test
   `tests/contracts/provider-network.test.js` congela el terminal SSE cuando el
   stream ya empezó y se interrumpe: no se reinicia retrospectivamente ese
   stream con OpenRouter. Corrección mínima propuesta, no aplicada: buffering o
   reanudación explícita antes de emitir contenido irreversible.

5. **Dependencias vulnerables — revisión `refactor/fix-audit` (sin upgrades
   retenidos).** `npm audit --json` con npm 11.17.0 y
   `https://registry.npmjs.org/` conectó y reportó 16 hallazgos: 12 high y 4
   moderate, todos en el árbol de producción (algunos también pueden estar en
   el árbol dev). Estado de paquete, no número de avisos individuales:

   | Paquete | Severidad | Relación | Entorno |
   |---|---|---|---|
   | `@puppeteer/browsers` | high | transitiva | producción |
   | `@xmldom/xmldom` | high | transitiva | producción |
   | `basic-ftp` | high | transitiva | producción |
   | `body-parser` | moderate | transitiva | producción |
   | `express` | moderate | directa | producción |
   | `extract-zip` | high | transitiva | producción |
   | `get-uri` | high | transitiva | producción |
   | `ip-address` | high | transitiva | producción |
   | `js-yaml` | high | transitiva | producción |
   | `multer` | high | directa | producción |
   | `pac-proxy-agent` | high | transitiva | producción |
   | `protobufjs` | moderate | transitiva | producción |
   | `proxy-agent` | high | transitiva | producción |
   | `puppeteer` | high | directa | producción |
   | `puppeteer-core` | high | transitiva | producción |
   | `qs` | moderate | transitiva | producción |

   Se revisó el plan `npm audit fix --dry-run`: 29 cambios semver compatibles,
   7 retiros, sin paquetes añadidos. El ensayo con scripts de instalación
   desactivados redujo el audit a 8 high, pero `npm run verify:all` falló en el
   contrato multipart del archivo exactamente de 10 MiB (esperado 413,
   observado 200 con Multer 2.4.0). Los pasos de baselines no llegaron a
   ejecutarse en ese intento. Se restauró `package-lock.json` y `npm ci
   --ignore-scripts` volvió a instalar Express 4.22.2, Multer 2.2.0 y Puppeteer
   24.39.1. No hay actualizaciones de dependencias retenidas ni commit de audit.

   Permanecen ocho entradas high asociadas al árbol de Puppeteer 24: `puppeteer`,
   `puppeteer-core`, `@puppeteer/browsers`, `basic-ftp`, `extract-zip`,
   `get-uri`, `pac-proxy-agent` y `proxy-agent`. npm solo ofrece corregirlas
   subiendo a Puppeteer 25.12.0 (major): riesgo de API, revisión/cache de Chrome,
   render PDF/PPTX y baselines. No aplicado. Express 5 también es major y no se
   aplica; el ensayo de Express 4.22.3 tampoco se retuvo porque la compuerta
   completa falló con el conjunto y se revirtió íntegramente.

6. **Puppeteer puede intentar instalar Chrome al importar/inicializar.**
   `src/backend/browser/manager.js` llama a `installChrome()` cuando el cache no
   contiene un ejecutable; la inicialización eager ocurre desde `server.js`.
   Evidencia: ramas `findChromeExecutable`/`installChrome` y el log de runtime
   install. Corrección mínima propuesta, no aplicada: provisionar el cache en
   CI/deploy y fallar de forma explícita si falta, o volver lazy la inicialización
   tras una caracterización específica de timing.
