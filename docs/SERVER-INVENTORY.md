# Inventario final de `src/backend/server.js`

Este inventario corresponde al cierre de la fase 3c. Las cifras de tamaño son líneas `LF` del blob Git, no el conteo de líneas de PowerShell; incluyen la línea final solo cuando contiene `LF` y se calcularon con el contenido almacenado en Git.

`src/backend/server.js` pasó de **1858 líneas LF** al inicio de 3c, en `21b238a`, a **424 líneas LF** al cierre de 3c.

## Mapa actual del servidor

| Líneas LF | Bloque | Responsabilidad |
| ---: | --- | --- |
| 1–60 | imports y bootstrap | dependencias, constantes compartidas y arranque del módulo |
| 62–108 | logger, runtime y configuración | logger, `NODE_ENV`, CORS, browser manager, colas y costuras de prueba |
| 110–153 | fábricas y utilidades de aplicación | logo, app HTML, exportación PDF/PPTX, ejemplos y helpers de respuesta |
| 156–189 | modelos y validación de entorno | modelos, defaults y llamada al validador de entorno |
| 191–222 | middleware y directorios | CORS, rate limit, logging HTTP, body parsers y directorios |
| 224–249 | sanitización de salida | alias de `sanitizeGeneratedHtml` e inyección de safety net |
| 251–305 | proveedores y handlers | runtime de proveedores y creación de handlers |
| 307–314 | inicialización eager | Puppeteer eager y registro de `SIGINT` |
| 316–365 | composición de rutas | dependencias de rutas y llamada a `registerBackendRoutes` |
| 367–415 | seguridad de proceso y listen | `uncaughtException`, `unhandledRejection`, Redis, listen y timeouts |
| 417–424 | fachada pública | `module.exports` con las seis exportaciones históricas |

## Módulos extraídos durante 3c.2–3c.4

| Módulo | Líneas LF | Contenido |
| --- | ---: | --- |
| `src/backend/export/pptx-renderer.js` | 1258 | renderer PPTX completo, trasladado as-is; excepción documentada por ser un bloque monolítico movido completo |
| `src/backend/config/models.js` | 57 | listas de modelos, razonamiento y defaults |
| `src/backend/config/environment.js` | 54 | validación de entorno y mensajes de configuración |
| `src/backend/files/content.js` | 58 | entidades, texto, título, stem y path HTML único |
| `src/backend/files/directories.js` | 38 | creación de directorios backend y factory compatible |
| `src/backend/providers/runtime.js` | 60 | composición del runtime Gemini/OpenRouter/fallback |
| `src/backend/contracts/topic-sanitizer.js` | 40 | reglas históricas de `sanitizeTema`, sin modificación funcional |
| `src/backend/contracts/request-normalizers.js` | 69 | normalizadores integrados en `POST /generate` |
| `src/backend/http/register-routes.js` | 74 | registro ordenado de entry, generation, finalize y download |

Cada carpeta nueva tiene su `README.md`, y los módulos extraídos conservan comentarios/JSDoc donde existían. El renderer PPTX es la única excepción de tamaño: se movió como bloque íntegro para evitar alterar su semántica interna.

## Bloques que permanecen deliberadamente

- Rate limiter, límites diarios, cooldowns, TTLs, cola y sus mensajes quedan en el servidor o en sus módulos existentes.
- La inicialización eager de Puppeteer, `SIGINT`, handlers de proceso, verificación Redis, `listen`, `requestTimeout` y `headersTimeout` conservan su orden original.
- Se intentó extraer el bloque de seguridad/listen a `src/backend/bootstrap/runtime.js`; la verificación detectó un `TS2322` adicional y el subpaso fue revertido sin commit.
- La fachada mantiene exactamente las seis exportaciones públicas históricas verificadas por `tests/contracts/server-exports.test.js`.

## Referencias de verificación

- Orden de router: `tests/contracts/router-order.test.js`.
- Fachada pública: `tests/contracts/server-exports.test.js`.
- Contrato HTTP de normalización: `tests/contracts/request-normalizer-http.test.js`, 50 casos.
- Auditoría de catches: `docs/BACKEND-CATCH-AUDIT.md`.
