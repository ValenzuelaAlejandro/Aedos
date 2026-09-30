# Contratos backend

Esta carpeta contiene límites, defaults, errores, SSE, tipos JSDoc y
normalizadores y la sanitización pura de temas que describen contratos ya
existentes. Los builders de `errors.js` son consumidos por las rutas HTTP;
`formatSseEvent` por el pipeline y la ruta de errores; `request-normalizers.js`
expone normalizadores individuales consumidos por `/generate`. `types.js` es
solo material JSDoc, sin consumidor en runtime. Cada archivo debe mantener una
responsabilidad pequeña y no debe iniciar servicios ni leer `req`/`res` salvo
en el punto de integración correspondiente.

Para añadir una constante, conserva el valor actual, documenta el origen en
un comentario y añade una prueba de equivalencia. Para añadir un error,
registra código, status, cuerpo/evento y consumidor antes de reemplazar el
literal en `server.js`. Los tipos deben reflejar fixtures y comportamiento
observado, incluidos campos opcionales o ambiguos.
