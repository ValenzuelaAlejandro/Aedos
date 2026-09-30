# Contratos backend

Esta carpeta contiene límites, defaults, errores, SSE, tipos JSDoc y
normalizadores y la sanitización pura de temas que describen contratos ya existentes. Cada archivo debe
mantener una responsabilidad pequeña y no debe iniciar servicios ni leer
`req`/`res` salvo en el punto de integración de `server.js`.

Para añadir una constante, conserva el valor actual, documenta el origen en
un comentario y añade una prueba de equivalencia. Para añadir un error,
registra código, status, cuerpo/evento y consumidor antes de reemplazar el
literal en `server.js`. Los tipos deben reflejar fixtures y comportamiento
observado, incluidos campos opcionales o ambiguos.
