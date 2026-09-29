# Pruebas de proveedores a nivel de red

Los fakes de `tests/helpers/provider-fakes.js` interceptan `global.fetch` y
`@google/genai` antes de cargar `server.js`; no habilitan
`AEDOS_TEST_STUB_PROVIDERS` ni realizan llamadas externas.

Quedaron cubiertos los eventos SSE de fallback Gemini → OpenRouter, fallo
midstream de Gemini, doble fallo y timeout de aceptación.

`QUEUE_FULL` no se incluye: al intentar repetirlo diez veces, la petición que
entra en `queue` dispara el `req.close` histórico después de terminar de leer
el body y es retirada inmediatamente. Hacerlo determinista requiere cambiar
la costura de producción, lo cual está fuera de esta fase.
