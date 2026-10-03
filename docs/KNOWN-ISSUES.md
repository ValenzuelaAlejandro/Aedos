# Known issues congelados en 3c

Estos problemas se documentan, pero no se corrigen en esta fase porque cambiarían
el comportamiento observable o pertenecen a una fase de correcciones separada.

1. **Cola y desconexión de petición — corregido.** `req.on('close')` también
   se dispara al terminar de leer el body, aunque la conexión HTTP siga viva;
   eso retiraba entradas válidas de la cola. `generation-queue-disconnect.test.js`
   reprodujo que la tercera conexión recibía 200 y quedaba esperando en vez del
   429 `QUEUE_FULL`. Corregido en el commit de esta rama
   `fix(queue): use response close for queued request cleanup`: ahora se
   elimina una entrada al cerrarse su response antes de terminar, y se
   desregistra el listener al adquirir o abandonar el slot. El test confirma
   429 real, FIFO y limpieza tras desconexión del cliente.

2. **Sanitización HTML — corregida parcialmente según el alcance autorizado.**
   El commit `fix(sanitization): block listed active content vectors` elimina
   `iframe`, `object`, `embed`, imports no permitidos, URLs `javascript:` y
   `data:text/html`, y declaraciones CSS con `expression()`, `behavior` o URLs
   peligrosas. Las fixtures adversariales están actualizadas. Las salidas
   sanitizadas y hashes de los ejemplos flash/pro siguen idénticos a HEAD antes
   del cambio; Google Fonts y `data:image/*` se conservan. No se amplió a una
   política HTML general ni a vectores no enumerados en esta tarea.

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
